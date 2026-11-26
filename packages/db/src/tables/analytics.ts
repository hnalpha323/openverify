/**
 * Workflow 9B Stage 1b, checkpoint (A): the analytics rollups (C163.3, C163.4), one table per row
 * type of `@openverify/core`'s `analytics/rows.ts`, in `ANALYTICS_ROLLUP_TABLES`' order, and the
 * per-environment rollup state. Frozen by `foundation-9b`; `api-analytics` writes and reads them
 * (`packages/db/src/repositories/analytics.ts`, `apps/api/src/services/analytics/`).
 *
 * Counts only, environment-scoped, deleted with their environment: no id of an end user and no value
 * (rule 11). The one exception is `analytics_case_assignee_daily.user_id`, an operator's id, so that
 * table is personal data about employees (review P20): its rows go with their user (the foreign key
 * cascades) and by `analytics-assignee-retention-months`.
 *
 * Every rollup row carries its local `day`, the `time_zone` it was computed in (C163.2: a zone change
 * never relabels a bucket it did not rebuild) and its `source` (C163.4): `facts` rows are deleted and
 * inserted again by each recompute of an open day; `redacted` rows hold the frozen contribution of
 * inquiries redacted while their day was open, which a redaction adds to (an upsert on the row's key).
 * Readers add both. Each table's key is one unique index, `NULLS NOT DISTINCT` (a dimension may be
 * `null`), led by `(environment_id, day)`, which also serves the range reads, the recompute's delete
 * and the retention delete.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
  type PgTable,
} from 'drizzle-orm/pg-core';
import {
  ANALYTICS_CHECK_STATUSES,
  ANALYTICS_FLOW_START_STEP_ID,
  ANALYTICS_ROLLUP_SOURCES,
  DURATION_BUCKET_COUNT,
  FILE_CAPTURE_METHODS,
  FLOW_RECORD_DEVICE_KINDS,
  FLOW_RECORD_PLATFORMS,
  FLOW_RECORD_STEP_ID_PATTERN,
  type AnalyticsCheckStatus,
  type AnalyticsRollupSource,
  type AnalyticsRollupTable,
  type FileCaptureMethod,
  type FlowRecordDeviceKind,
  type FlowRecordPlatform,
} from '@openverify/core';
import { idPattern } from '../ids.js';
import { countryCodeFormat, hexDigest, idColumnFormat, oneOf, updatedAt } from './columns.js';
import { checkRequirement, verificationType } from './enums.js';
import { environmentId } from './environment-id.js';
import { environments } from './tenancy.js';
import { users } from './users.js';

/** The longest reporting zone name the settings route accepts (`analyticsTimeZoneSchema`). */
const TIME_ZONE_MAX_LENGTH = 64;

/** A count column: a non-negative integer, 0 until a recompute or a redaction writes it. */
const count = (name: string) => integer(name).notNull().default(0);

/** The columns every rollup row has (`AnalyticsRowKey`). */
const rollupKey = () => ({
  environmentId: environmentId(),
  /** The local day, in `time_zone`. */
  day: date('day', { mode: 'string' }).notNull(),
  timeZone: text('time_zone').notNull(),
  source: text('source').$type<AnalyticsRollupSource>().notNull(),
});

/** The inquiry dimensions of C163.3 (`AnalyticsInquiryDimensions`). */
const inquiryDimensions = () => ({
  inquiryTemplateId: text('inquiry_template_id').notNull(),
  inquiryTemplateVersionId: text('inquiry_template_version_id').notNull(),
  /** The inquiry's `first_platform`; `null` when no session served a step. */
  platform: text('platform').$type<FlowRecordPlatform>(),
  /** The inquiry's `first_device_kind`; `null` when unknown. */
  deviceKind: text('device_kind').$type<FlowRecordDeviceKind>(),
});

/** A template and version without the device dimensions (steps, verifications, checks). */
const versionDimensions = () => ({
  inquiryTemplateId: text('inquiry_template_id').notNull(),
  inquiryTemplateVersionId: text('inquiry_template_version_id').notNull(),
});

interface KeyColumns {
  source: AnyPgColumn;
  timeZone: AnyPgColumn;
}

/** The key's CHECKs: the source and the zone's length. */
const keyChecks = (name: string, table: KeyColumns) => [
  check(`${name}_source_valid`, oneOf(table.source, ANALYTICS_ROLLUP_SOURCES)),
  check(
    `${name}_time_zone_length`,
    sql`char_length(${table.timeZone}) between 1 and ${sql.raw(String(TIME_ZONE_MAX_LENGTH))}`,
  ),
];

/** The template and version ids in their C1 forms. */
const versionChecks = (
  name: string,
  table: { inquiryTemplateId: AnyPgColumn; inquiryTemplateVersionId: AnyPgColumn },
) => [
  idColumnFormat(`${name}_inquiry_template_id_format`, table.inquiryTemplateId, 'itmpl'),
  idColumnFormat(
    `${name}_inquiry_template_version_id_format`,
    table.inquiryTemplateVersionId,
    'itmplv',
  ),
];

/** The device dimensions in their vocabularies, or `null`. */
const deviceChecks = (name: string, table: { platform: AnyPgColumn; deviceKind: AnyPgColumn }) => [
  check(
    `${name}_platform_valid`,
    sql`${table.platform} is null or ${oneOf(table.platform, FLOW_RECORD_PLATFORMS)}`,
  ),
  check(
    `${name}_device_kind_valid`,
    sql`${table.deviceKind} is null or ${oneOf(table.deviceKind, FLOW_RECORD_DEVICE_KINDS)}`,
  ),
];

/** `<name>_counts_nonnegative`: every count of the row is at least 0. */
const countsNonNegative = (name: string, columns: readonly AnyPgColumn[]) =>
  check(
    `${name}_counts_nonnegative`,
    sql.join(
      columns.map((column): SQL => sql`${column} >= 0`),
      sql` and `,
    ),
  );

/** C163.5: a histogram of `DURATION_BUCKET_COUNT` non-negative counts. */
const histogramShape = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`cardinality(${column}) = ${sql.raw(String(DURATION_BUCKET_COUNT))} and 0 <= all(${column})`,
  );

/** A step id in the flow's form (`FLOW_RECORD_STEP_ID_PATTERN`). */
const stepIdFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ ${sql.raw(`'${FLOW_RECORD_STEP_ID_PATTERN}'`)}`);

/** A short code (a check name, a reason, a signal name, a bin): 1 to `max` characters. */
const codeLength = (name: string, column: AnyPgColumn, max: number) =>
  check(name, sql`char_length(${column}) between 1 and ${sql.raw(String(max))}`);

/** The histogram column: 40 counts, filled by the recompute. */
const histogram = (name: string) => integer(name).array().notNull();

// Inquiries ------------------------------------------------------------------------------------

/** `analytics_inquiry_daily` (`AnalyticsInquiryDailyRow`): an inquiry counts on its creation day. */
export const analyticsInquiryDaily = pgTable(
  'analytics_inquiry_daily',
  {
    ...rollupKey(),
    ...inquiryDimensions(),
    created: count('created'),
    started: count('started'),
    interacted: count('interacted'),
    finished: count('finished'),
    completed: count('completed'),
    completedVerified: count('completed_verified'),
    completedWithFallback: count('completed_with_fallback'),
    completedUnverified: count('completed_unverified'),
    failed: count('failed'),
    expiredBeforeStart: count('expired_before_start'),
    expiredAfterStart: count('expired_after_start'),
    approved: count('approved'),
    declined: count('declined'),
    needsReview: count('needs_review'),
    markedForReview: count('marked_for_review'),
    decidedAutomatic: count('decided_automatic'),
    decidedManual: count('decided_manual'),
    decidedNotDeclared: count('decided_not_declared'),
    finishSecondsHistogram: histogram('finish_seconds_histogram'),
  },
  (table) => [
    unique('analytics_inquiry_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.platform,
        table.deviceKind,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_inquiry_daily', table),
    ...versionChecks('analytics_inquiry_daily', table),
    ...deviceChecks('analytics_inquiry_daily', table),
    countsNonNegative('analytics_inquiry_daily', [
      table.created,
      table.started,
      table.interacted,
      table.finished,
      table.completed,
      table.completedVerified,
      table.completedWithFallback,
      table.completedUnverified,
      table.failed,
      table.expiredBeforeStart,
      table.expiredAfterStart,
      table.approved,
      table.declined,
      table.needsReview,
      table.markedForReview,
      table.decidedAutomatic,
      table.decidedManual,
      table.decidedNotDeclared,
    ]),
    histogramShape('analytics_inquiry_daily_histogram_shape', table.finishSecondsHistogram),
  ],
);

/** `analytics_inquiry_tag_daily`: keyed by the tag's name (tags have no id; review F14). */
export const analyticsInquiryTagDaily = pgTable(
  'analytics_inquiry_tag_daily',
  {
    ...rollupKey(),
    ...inquiryDimensions(),
    tag: text('tag').notNull(),
    created: count('created'),
    finished: count('finished'),
    completed: count('completed'),
    failed: count('failed'),
  },
  (table) => [
    unique('analytics_inquiry_tag_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.platform,
        table.deviceKind,
        table.tag,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_inquiry_tag_daily', table),
    ...versionChecks('analytics_inquiry_tag_daily', table),
    ...deviceChecks('analytics_inquiry_tag_daily', table),
    // C9: a tag is 1 to 64 characters.
    codeLength('analytics_inquiry_tag_daily_tag_length', table.tag, 64),
    countsNonNegative('analytics_inquiry_tag_daily', [
      table.created,
      table.finished,
      table.completed,
      table.failed,
    ]),
  ],
);

// The funnel (C164.2) ------------------------------------------------------------------------

/** `analytics_step_daily`: a version's step, from the step record. */
export const analyticsStepDaily = pgTable(
  'analytics_step_daily',
  {
    ...rollupKey(),
    ...versionDimensions(),
    stepId: text('step_id').notNull(),
    entered: count('entered'),
    exited: count('exited'),
    revisits: count('revisits'),
  },
  (table) => [
    unique('analytics_step_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.stepId,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_step_daily', table),
    ...versionChecks('analytics_step_daily', table),
    stepIdFormat('analytics_step_daily_step_id_format', table.stepId),
    countsNonNegative('analytics_step_daily', [table.entered, table.exited, table.revisits]),
  ],
);

/** `analytics_transition_daily`: a move between two person-visible steps of a version. */
export const analyticsTransitionDaily = pgTable(
  'analytics_transition_daily',
  {
    ...rollupKey(),
    ...versionDimensions(),
    fromStepId: text('from_step_id').notNull(),
    toStepId: text('to_step_id').notNull(),
    count: count('count'),
  },
  (table) => [
    unique('analytics_transition_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.fromStepId,
        table.toStepId,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_transition_daily', table),
    ...versionChecks('analytics_transition_daily', table),
    // K9-24 (AL6): `$start`, the reserved step the entry step is entered from.
    check(
      'analytics_transition_daily_from_step_id_format',
      sql`${table.fromStepId} = ${sql.raw(`'${ANALYTICS_FLOW_START_STEP_ID}'`)} or ${table.fromStepId} ~ ${sql.raw(`'${FLOW_RECORD_STEP_ID_PATTERN}'`)}`,
    ),
    stepIdFormat('analytics_transition_daily_to_step_id_format', table.toStepId),
    countsNonNegative('analytics_transition_daily', [table.count]),
  ],
);

/** `analytics_path_daily`: the per-path view (review H17); `path_sha256` keys `step_ids`. */
export const analyticsPathDaily = pgTable(
  'analytics_path_daily',
  {
    ...rollupKey(),
    ...versionDimensions(),
    pathSha256: text('path_sha256').notNull(),
    stepIds: text('step_ids').array().notNull(),
    count: count('count'),
  },
  (table) => [
    unique('analytics_path_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.pathSha256,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_path_daily', table),
    ...versionChecks('analytics_path_daily', table),
    hexDigest('analytics_path_daily_path_sha256_format', table.pathSha256),
    check('analytics_path_daily_step_ids_present', sql`cardinality(${table.stepIds}) >= 1`),
    countsNonNegative('analytics_path_daily', [table.count]),
  ],
);

// Verifications and checks (C164.3, C164.4) ---------------------------------------------------

/** `analytics_verification_daily`: attempts by type, capture method and the ID's country. */
export const analyticsVerificationDaily = pgTable(
  'analytics_verification_daily',
  {
    ...rollupKey(),
    ...versionDimensions(),
    verificationType: verificationType('verification_type').notNull(),
    /** `files.capture_method`, client-reported (C153.2); `null` when none was reported. */
    captureMethod: text('capture_method').$type<FileCaptureMethod>(),
    /** The government ID's country; `null` for other types or unknown. */
    country: text('country'),
    created: count('created'),
    submitted: count('submitted'),
    passed: count('passed'),
    failed: count('failed'),
    requiresRetry: count('requires_retry'),
    skipped: count('skipped'),
    needsReview: count('needs_review'),
    canceled: count('canceled'),
  },
  (table) => [
    unique('analytics_verification_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.verificationType,
        table.captureMethod,
        table.country,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_verification_daily', table),
    ...versionChecks('analytics_verification_daily', table),
    check(
      'analytics_verification_daily_capture_method_valid',
      sql`${table.captureMethod} is null or ${oneOf(table.captureMethod, FILE_CAPTURE_METHODS)}`,
    ),
    countryCodeFormat('analytics_verification_daily_country_iso2', table.country),
    countsNonNegative('analytics_verification_daily', [
      table.created,
      table.submitted,
      table.passed,
      table.failed,
      table.requiresRetry,
      table.skipped,
      table.needsReview,
      table.canceled,
    ]),
  ],
);

/** `analytics_verification_step_daily`: the per-person-and-step outcome (review H06). */
export const analyticsVerificationStepDaily = pgTable(
  'analytics_verification_step_daily',
  {
    ...rollupKey(),
    ...versionDimensions(),
    stepId: text('step_id').notNull(),
    verificationType: verificationType('verification_type').notNull(),
    entered: count('entered'),
    passed: count('passed'),
    failedAfterAttempts: count('failed_after_attempts'),
    needsReview: count('needs_review'),
    skipped: count('skipped'),
  },
  (table) => [
    unique('analytics_verification_step_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.stepId,
        table.verificationType,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_verification_step_daily', table),
    ...versionChecks('analytics_verification_step_daily', table),
    stepIdFormat('analytics_verification_step_daily_step_id_format', table.stepId),
    countsNonNegative('analytics_verification_step_daily', [
      table.entered,
      table.passed,
      table.failedAfterAttempts,
      table.needsReview,
      table.skipped,
    ]),
  ],
);

/**
 * `analytics_check_daily`: results by check, requirement and status (review H03): `errored` and
 * `not_configured` are their own statuses, never `not_applicable`; `pending` too (B12).
 */
export const analyticsCheckDaily = pgTable(
  'analytics_check_daily',
  {
    ...rollupKey(),
    ...versionDimensions(),
    verificationType: verificationType('verification_type').notNull(),
    checkName: text('check_name').notNull(),
    requirement: checkRequirement('requirement').notNull(),
    status: text('status').$type<AnalyticsCheckStatus>().notNull(),
    count: count('count'),
  },
  (table) => [
    unique('analytics_check_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.verificationType,
        table.checkName,
        table.requirement,
        table.status,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_check_daily', table),
    ...versionChecks('analytics_check_daily', table),
    // The check name's form, as `verification_checks_name_snake_case`.
    check(
      'analytics_check_daily_check_name_snake_case',
      sql`${table.checkName} ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'`,
    ),
    check('analytics_check_daily_status_valid', oneOf(table.status, ANALYTICS_CHECK_STATUSES)),
    countsNonNegative('analytics_check_daily', [table.count]),
  ],
);

/** `analytics_check_reason_daily`: results by check, its type and requirement, and reason code. */
export const analyticsCheckReasonDaily = pgTable(
  'analytics_check_reason_daily',
  {
    ...rollupKey(),
    ...versionDimensions(),
    // K9-24 (AL7): a check used as required and as not required keeps its reasons apart.
    verificationType: verificationType('verification_type').notNull(),
    checkName: text('check_name').notNull(),
    requirement: checkRequirement('requirement').notNull(),
    reason: text('reason').notNull(),
    count: count('count'),
  },
  (table) => [
    unique('analytics_check_reason_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.verificationType,
        table.checkName,
        table.requirement,
        table.reason,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_check_reason_daily', table),
    ...versionChecks('analytics_check_reason_daily', table),
    check(
      'analytics_check_reason_daily_check_name_snake_case',
      sql`${table.checkName} ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'`,
    ),
    codeLength('analytics_check_reason_daily_reason_length', table.reason, 128),
    countsNonNegative('analytics_check_reason_daily', [table.count]),
  ],
);

// Cases (C164.5) -------------------------------------------------------------------------------

/** `analytics_case_daily`: cases on their own creation day (review H05). */
export const analyticsCaseDaily = pgTable(
  'analytics_case_daily',
  {
    ...rollupKey(),
    caseTemplateId: text('case_template_id').notNull(),
    created: count('created'),
    resolved: count('resolved'),
    slaMet: count('sla_met'),
    slaMissed: count('sla_missed'),
    resolutionSecondsHistogram: histogram('resolution_seconds_histogram'),
  },
  (table) => [
    unique('analytics_case_daily_key')
      .on(table.environmentId, table.day, table.timeZone, table.source, table.caseTemplateId)
      .nullsNotDistinct(),
    ...keyChecks('analytics_case_daily', table),
    idColumnFormat('analytics_case_daily_case_template_id_format', table.caseTemplateId, 'ctmpl'),
    countsNonNegative('analytics_case_daily', [
      table.created,
      table.resolved,
      table.slaMet,
      table.slaMissed,
    ]),
    histogramShape('analytics_case_daily_histogram_shape', table.resolutionSecondsHistogram),
  ],
);

/**
 * `analytics_case_assignee_daily`: personal data about employees (review P20), served only to
 * holders of `users:write` and never exported by name. `user_id` is `null` once re-keyed to "former
 * user"; the rows of a deleted user go with it (the foreign key cascades; no product path deletes a
 * user at 9B, which deactivates instead).
 */
export const analyticsCaseAssigneeDaily = pgTable(
  'analytics_case_assignee_daily',
  {
    ...rollupKey(),
    caseTemplateId: text('case_template_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    assigned: count('assigned'),
    resolved: count('resolved'),
  },
  (table) => [
    unique('analytics_case_assignee_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.caseTemplateId,
        table.userId,
      )
      .nullsNotDistinct(),
    // The re-key, the cascade and the assignee retention find a user's rows without a scan.
    index('analytics_case_assignee_daily_user_id_idx').on(table.userId),
    ...keyChecks('analytics_case_assignee_daily', table),
    idColumnFormat(
      'analytics_case_assignee_daily_case_template_id_format',
      table.caseTemplateId,
      'ctmpl',
    ),
    check(
      'analytics_case_assignee_daily_user_id_format',
      sql`${table.userId} is null or ${table.userId} ~ ${sql.raw(`'${idPattern('usr')}'`)}`,
    ),
    countsNonNegative('analytics_case_assignee_daily', [table.assigned, table.resolved]),
  ],
);

// Signals (C164.6) -----------------------------------------------------------------------------

/** `analytics_signal_daily`: values in the registry's fixed bins, `not-evaluated` for a null. */
export const analyticsSignalDaily = pgTable(
  'analytics_signal_daily',
  {
    ...rollupKey(),
    ...inquiryDimensions(),
    signalName: text('signal_name').notNull(),
    bin: text('bin').notNull(),
    count: count('count'),
  },
  (table) => [
    unique('analytics_signal_daily_key')
      .on(
        table.environmentId,
        table.day,
        table.timeZone,
        table.source,
        table.inquiryTemplateId,
        table.inquiryTemplateVersionId,
        table.platform,
        table.deviceKind,
        table.signalName,
        table.bin,
      )
      .nullsNotDistinct(),
    ...keyChecks('analytics_signal_daily', table),
    ...versionChecks('analytics_signal_daily', table),
    ...deviceChecks('analytics_signal_daily', table),
    codeLength('analytics_signal_daily_signal_name_length', table.signalName, 128),
    codeLength('analytics_signal_daily_bin_length', table.bin, 32),
    countsNonNegative('analytics_signal_daily', [table.count]),
  ],
);

// The rollup state (a Stage 1b amendment: C163.2, C163.4 and C164.8 need it) -------------------

/**
 * `analytics_rollup_state`: one row per environment the rollup has run for, `api-analytics`'.
 * - `rolled_up_through`: the watermark the last pass covered (C163.4: it trails `now()` by two
 *   minutes), served as `freshness.rolled-up-through`; `null` before the first pass;
 * - `outcomes_as_of`: when the open days' outcome columns were last recomputed (once a local day,
 *   P21), served as `freshness.outcomes-as-of`;
 * - `time_zone`: the zone the open days were last built in, so a change is seen and rebuilt (C163.2);
 * - `step_data_from`: the local day of the environment's first step record, set once and never
 *   moved, since a redaction deletes step records (C163.1: earlier buckets show "no step data").
 */
export const analyticsRollupState = pgTable(
  'analytics_rollup_state',
  {
    environmentId: text('environment_id')
      .primaryKey()
      .references(() => environments.id, { onDelete: 'cascade' }),
    rolledUpThrough: timestamp('rolled_up_through', { withTimezone: true }),
    outcomesAsOf: timestamp('outcomes_as_of', { withTimezone: true }),
    timeZone: text('time_zone'),
    stepDataFrom: date('step_data_from', { mode: 'string' }),
    /** K9-24 (AA6): the last local day closed; a raised settle window never reopens it. */
    closedThrough: date('closed_through', { mode: 'string' }),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'analytics_rollup_state_time_zone_length',
      sql`${table.timeZone} is null or char_length(${table.timeZone}) between 1 and ${sql.raw(String(TIME_ZONE_MAX_LENGTH))}`,
    ),
  ],
);

/** The twelve rollup tables by name (`ANALYTICS_ROLLUP_TABLES`' order). */
export const analyticsRollupTables = {
  analytics_inquiry_daily: analyticsInquiryDaily,
  analytics_inquiry_tag_daily: analyticsInquiryTagDaily,
  analytics_step_daily: analyticsStepDaily,
  analytics_transition_daily: analyticsTransitionDaily,
  analytics_path_daily: analyticsPathDaily,
  analytics_verification_daily: analyticsVerificationDaily,
  analytics_verification_step_daily: analyticsVerificationStepDaily,
  analytics_check_daily: analyticsCheckDaily,
  analytics_check_reason_daily: analyticsCheckReasonDaily,
  analytics_case_daily: analyticsCaseDaily,
  analytics_case_assignee_daily: analyticsCaseAssigneeDaily,
  analytics_signal_daily: analyticsSignalDaily,
} as const satisfies Record<AnalyticsRollupTable, PgTable>;

export type AnalyticsInquiryDailyRecord = typeof analyticsInquiryDaily.$inferSelect;
export type AnalyticsRollupStateRecord = typeof analyticsRollupState.$inferSelect;
