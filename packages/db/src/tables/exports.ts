/**
 * Phase 9, Workflow 9B Stage 1b (X) (C165, C166, C174.5): generic exports, saved views and bulk
 * report jobs, frozen by `foundation-9b` for `api-exports`.
 *
 * - `exports` (`exp_`, decision 43): one CSV of a list's filter or a saved view, cut by the `export`
 *   job for its creating principal alone (C166.1). It mirrors Phase 8's `case_exports` (C138.1): the
 *   request (the filter's values, personal data in a list's filter) is sealed for the row and goes
 *   when the export finishes, only its keys stay (`filter_keys`, the shape the audit records); the
 *   file is an envelope object (`encryptBytes`, the wrapped key on the row) kept 24 hours
 *   (`EXPORT_LIMITS['retention-hours']`) and deleted by `export-sweep` and the C16 pass, after which
 *   the export reads `expired` and keeps its count and times.
 * - `saved_views` (`svw_`, decision 44): a user's view of one of `SAVED_VIEW_LISTS`, deleted with its
 *   owner. Its filters are plaintext because a view never holds a filter the list marks as personal
 *   data (C165.2, `saved_view_pii_filter`); the API refuses those before anything is stored.
 * - `report_bulk_jobs` (`rbulk_`, C166.5): an uploaded CSV of query sources for one report template,
 *   an envelope object (third-party personal data, review P24) deleted when the job ends and swept by
 *   `export-sweep` for jobs that ended or are older than 24 hours; `report_bulk_job_rows` records each
 *   CSV row once, created (naming its report) or failed (its code), never skipped (C166.6).
 *
 * No trigger moves `updated_at`: the owner's repositories set it on every write, as
 * `notification_preferences` does (Stage 1b (W)), so migration 0031 keeps no hand edit.
 */
import {
  EXPORT_FORMATS,
  EXPORT_LIMITS,
  EXPORT_OBJECT_TYPES,
  EXPORT_STATUSES,
  REPORT_BULK_JOB_STATUSES,
  REPORT_BULK_ROW_OUTCOMES,
  SAVED_VIEW_LISTS,
  type ExportFormat,
  type ExportObjectType,
  type ExportStatus,
  type ReportBulkJobStatus,
  type ReportBulkRowOutcome,
  type SavedViewList,
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
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { createdAt, idColumnFormat, idFormat, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { reportTemplates } from './reports.js';
import { users } from './users.js';

/** C166.1, C166.5: who asked; a workflow run neither exports nor uploads a bulk CSV. */
export const EXPORT_CREATOR_TYPES = ['user', 'api-key'] as const;
export type ExportCreatorType = (typeof EXPORT_CREATOR_TYPES)[number];

/**
 * C166.5 (ours, provisional): a bulk CSV's rows, `REPORT_BULK_LIMITS.rows` of
 * `@openverify/contracts`, which `packages/db` does not depend on; an API test holds them equal.
 */
export const REPORT_BULK_MAX_ROWS = 1000;

/** C166.6: an export's or a job's error, a problem code and nothing else. */
const PROBLEM_CODE = '^[a-z][a-z0-9]*(_[a-z0-9]+)*$';

/** `encryptBytes`' wrapped data key, as `files.wrapped_dek` reads. */
const wrappedDekFormat = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`${column} is null or ${column} ~ '^ov1\\.[A-Za-z0-9_-]{11}\\.[A-Za-z0-9_-]{80}$'`,
  );

/** The creator pair: a user (`usr_`) or an API key (`key_`). */
function creatorChecks(table: string, typeColumn: AnyPgColumn, idColumn: AnyPgColumn) {
  return [
    check(`${table}_creator_type_valid`, oneOf(typeColumn, EXPORT_CREATOR_TYPES)),
    check(
      `${table}_creator_id_format`,
      sql`(${typeColumn} is distinct from 'user' or ${idColumn} ~ ${sql.raw(`'${idPattern('usr')}'`)})
        and (${typeColumn} is distinct from 'api-key'
          or ${idColumn} ~ ${sql.raw(`'${idPattern('key')}'`)})`,
    ),
  ];
}

/** C166.1, C166.6: an asynchronous CSV of a list, its creator's alone. */
export const dataExports = pgTable(
  'exports',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    creatorType: text('creator_type').$type<ExportCreatorType>().notNull(),
    creatorId: text('creator_id').notNull(),
    objectType: text('object_type').$type<ExportObjectType>().notNull(),
    format: text('format').$type<ExportFormat>().notNull(),
    /** C166.1: personal columns unmasked; needs `pii:view` when asked and at each download. */
    includePersonalData: boolean('include_personal_data').notNull().default(false),
    status: text('status').$type<ExportStatus>().notNull().default('pending'),
    /** The filter (or the saved view's filters) with its values, sealed; `null` once finished. */
    requestSealed: sealedColumn('request'),
    /** C166.6: the filter's shape, its keys only, never a value. */
    filterKeys: text('filter_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The saved view the export used; an id only, since a view may later be deleted. */
    savedViewId: text('saved_view_id'),
    rowCount: integer('row_count'),
    /** The file's plaintext size, while it is kept. */
    byteSize: integer('byte_size'),
    /** A failure's problem code, such as `export_too_large`; nothing else. */
    errorCode: text('error_code'),
    /** S3 object key of the file's ciphertext, while it is kept. */
    storageKey: text('storage_key'),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`, while the file is kept. */
    wrappedDek: text('wrapped_dek'),
    /** C166.1, review P36: when the rows were read, the export's point in time. */
    cutAt: timestamptz('cut_at'),
    completedAt: timestamptz('completed_at'),
    /** When the file is deleted: `EXPORT_LIMITS['retention-hours']` after it completed. */
    expiresAt: timestamptz('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('exports_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('exports_storage_key_key').on(table.storageKey),
    // C166.4: `GET /exports` lists the caller's own, newest first.
    index('exports_creator_created_at_idx').on(
      table.environmentId,
      table.creatorType,
      table.creatorId,
      table.createdAt,
      table.id,
    ),
    // C174.3: `export-sweep` and the C16 pass delete the files that expired.
    index('exports_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'completed'`),
    // The exports the `export` job still owes, oldest first.
    index('exports_unfinished_idx')
      .on(table.createdAt)
      .where(sql`${table.status} in ('pending', 'running')`),
    idFormat('exports', table.id, 'exp'),
    ...creatorChecks('exports', table.creatorType, table.creatorId),
    check('exports_object_type_valid', oneOf(table.objectType, EXPORT_OBJECT_TYPES)),
    check('exports_format_valid', oneOf(table.format, EXPORT_FORMATS)),
    check('exports_status_valid', oneOf(table.status, EXPORT_STATUSES)),
    idColumnFormat('exports_saved_view_id_format', table.savedViewId, 'svw'),
    check(
      'exports_filter_keys_size',
      sql`coalesce(array_length(${table.filterKeys}, 1), 0) <= 100
        and array_position(${table.filterKeys}, null) is null`,
    ),
    // P19, as case exports: the request is kept exactly while the export is to be cut.
    check(
      'exports_request_until_finished',
      sql`(${table.requestSealed} is not null) = (${table.status} in ('pending', 'running'))`,
    ),
    check(
      'exports_finished_with_times',
      sql`(${table.status} in ('completed', 'expired')) = (${table.completedAt} is not null
        and ${table.expiresAt} is not null and ${table.cutAt} is not null
        and ${table.rowCount} is not null)`,
    ),
    // The file and its key exactly while it is kept.
    check(
      'exports_file_while_completed',
      sql`(${table.status} = 'completed') = (${table.storageKey} is not null)
        and (${table.storageKey} is null) = (${table.wrappedDek} is null)`,
    ),
    // C166.6 (the contract): only a file still kept has a size.
    check(
      'exports_size_while_completed',
      sql`(${table.status} = 'completed') = (${table.byteSize} is not null)`,
    ),
    check(
      'exports_error_when_failed',
      sql`(${table.status} = 'failed') = (${table.errorCode} is not null)
        and (${table.errorCode} is null or ${table.errorCode} ~ ${sql.raw(`'${PROBLEM_CODE}'`)})`,
    ),
    check(
      'exports_counts',
      sql`(${table.rowCount} is null
          or ${table.rowCount} between 0 and ${sql.raw(String(EXPORT_LIMITS.rows))})
        and (${table.byteSize} is null or ${table.byteSize} >= 0)`,
    ),
    wrappedDekFormat('exports_wrapped_dek_format', table.wrappedDek),
  ],
);

/** C165.1: a user's view of a list (decision 44). */
export const savedViews = pgTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    /** The only user who may change or delete it; the view goes with them. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    list: text('list').$type<SavedViewList>().notNull(),
    name: text('name').notNull(),
    /** The list route's filter parameters, paging left out; never a personal-data filter (C165.2). */
    filters: jsonb('filters')
      .$type<Record<string, string | string[]>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    columns: text('columns')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** One sort attribute, `-` first for descending. */
    sort: text('sort'),
    /** C165.1: visible to every user of the environment who can read the list. */
    shared: boolean('shared').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('saved_views_environment_id_id_key').on(table.environmentId, table.id),
    // `GET /dashboard/saved-views`: the caller's own, by list.
    index('saved_views_owner_list_idx').on(
      table.environmentId,
      table.ownerId,
      table.list,
      table.createdAt,
      table.id,
    ),
    // ... and the environment's shared ones.
    index('saved_views_shared_list_idx')
      .on(table.environmentId, table.list, table.createdAt, table.id)
      .where(sql`${table.shared}`),
    index('saved_views_owner_id_idx').on(table.ownerId),
    idFormat('saved_views', table.id, 'svw'),
    check('saved_views_list_valid', oneOf(table.list, SAVED_VIEW_LISTS)),
    check('saved_views_name_length', sql`char_length(${table.name}) between 1 and 100`),
    check('saved_views_filters_object', sql`jsonb_typeof(${table.filters}) = 'object'`),
    check(
      'saved_views_columns_size',
      sql`coalesce(array_length(${table.columns}, 1), 0) <= 50
        and array_position(${table.columns}, null) is null`,
    ),
    check(
      'saved_views_sort_length',
      sql`${table.sort} is null or char_length(${table.sort}) between 1 and 65`,
    ),
  ],
);

/** C166.5: a bulk report creation from an uploaded CSV, ours (`rbulk_`). */
export const reportBulkJobs = pgTable(
  'report_bulk_jobs',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    creatorType: text('creator_type').$type<ExportCreatorType>().notNull(),
    creatorId: text('creator_id').notNull(),
    reportTemplateId: text('report_template_id').notNull(),
    status: text('status').$type<ReportBulkJobStatus>().notNull().default('pending'),
    /** The CSV's data rows, once read. */
    rowCount: integer('row_count'),
    /** A whole-file refusal's code (a header or size problem); per-row failures are rows. */
    errorCode: text('error_code'),
    /** S3 object key of the CSV's ciphertext, until the job ends or the sweep deletes it. */
    storageKey: text('storage_key'),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`, with the object. */
    wrappedDek: text('wrapped_dek'),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('report_bulk_jobs_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('report_bulk_jobs_storage_key_key').on(table.storageKey),
    foreignKey({
      name: 'report_bulk_jobs_report_template_fk',
      columns: [table.environmentId, table.reportTemplateId],
      foreignColumns: [reportTemplates.environmentId, reportTemplates.id],
    }).onDelete('cascade'),
    // C174.3: `export-sweep` deletes the CSVs of ended or day-old jobs.
    index('report_bulk_jobs_file_idx')
      .on(table.createdAt)
      .where(sql`${table.storageKey} is not null`),
    // The jobs the `report-bulk` job still owes, oldest first.
    index('report_bulk_jobs_unfinished_idx')
      .on(table.createdAt)
      .where(sql`${table.status} in ('pending', 'running')`),
    idFormat('report_bulk_jobs', table.id, 'rbulk'),
    ...creatorChecks('report_bulk_jobs', table.creatorType, table.creatorId),
    idColumnFormat('report_bulk_jobs_report_template_id_format', table.reportTemplateId, 'rptp'),
    check('report_bulk_jobs_status_valid', oneOf(table.status, REPORT_BULK_JOB_STATUSES)),
    check(
      'report_bulk_jobs_ended_with_time',
      sql`(${table.status} in ('completed', 'failed')) = (${table.completedAt} is not null)`,
    ),
    check(
      'report_bulk_jobs_error_when_failed',
      sql`(${table.errorCode} is null or ${table.status} = 'failed')
        and (${table.errorCode} is null or ${table.errorCode} ~ ${sql.raw(`'${PROBLEM_CODE}'`)})`,
    ),
    check(
      'report_bulk_jobs_file_whole',
      sql`(${table.storageKey} is null) = (${table.wrappedDek} is null)`,
    ),
    check(
      'report_bulk_jobs_row_count_range',
      sql`${table.rowCount} is null
        or ${table.rowCount} between 0 and ${sql.raw(String(REPORT_BULK_MAX_ROWS))}`,
    ),
    wrappedDekFormat('report_bulk_jobs_wrapped_dek_format', table.wrappedDek),
  ],
);

/** C166.6: one CSV row's outcome, its number (the header is row 0), the report or the code. */
export const reportBulkJobRows = pgTable(
  'report_bulk_job_rows',
  {
    environmentId: environmentId(),
    jobId: text('job_id').notNull(),
    rowNumber: integer('row_number').notNull(),
    outcome: text('outcome').$type<ReportBulkRowOutcome>().notNull(),
    /** The report a created row made; an id only (no foreign key: the row is the job's record). */
    reportId: text('report_id'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'report_bulk_job_rows_pkey',
      columns: [table.environmentId, table.jobId, table.rowNumber],
    }),
    foreignKey({
      name: 'report_bulk_job_rows_job_fk',
      columns: [table.environmentId, table.jobId],
      foreignColumns: [reportBulkJobs.environmentId, reportBulkJobs.id],
    }).onDelete('cascade'),
    check(
      'report_bulk_job_rows_row_number_range',
      sql`${table.rowNumber} between 1 and ${sql.raw(String(REPORT_BULK_MAX_ROWS))}`,
    ),
    check('report_bulk_job_rows_outcome_valid', oneOf(table.outcome, REPORT_BULK_ROW_OUTCOMES)),
    idColumnFormat('report_bulk_job_rows_report_id_format', table.reportId, 'rep'),
    check(
      'report_bulk_job_rows_created_names_report',
      sql`(${table.outcome} = 'created') = (${table.reportId} is not null)`,
    ),
    check(
      'report_bulk_job_rows_failed_has_code',
      sql`(${table.outcome} = 'failed') = (${table.errorCode} is not null)`,
    ),
    check(
      'report_bulk_job_rows_error_code_format',
      sql`${table.errorCode} is null or ${table.errorCode} ~ ${sql.raw(`'${PROBLEM_CODE}'`)}`,
    ),
  ],
);

export type ExportRow = typeof dataExports.$inferSelect;
export type SavedViewRow = typeof savedViews.$inferSelect;
export type ReportBulkJobRow = typeof reportBulkJobs.$inferSelect;
export type ReportBulkJobRowRow = typeof reportBulkJobRows.$inferSelect;
