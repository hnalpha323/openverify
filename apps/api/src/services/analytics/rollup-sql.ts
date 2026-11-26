/**
 * C163.3, C163.4 (Workflow 9B, `api-analytics`): the rollup SQL in the reporting zone, the one query
 * set every writer and reader shares:
 * - the refresh (`refresh.ts`) recomputes an open day's `facts` rows from the environment's
 *   unredacted inquiries of that local day;
 * - a redaction (`redaction.ts`) computes the same rows for its one inquiry, before anything is
 *   cleared, and adds them to the `redacted` rows;
 * - the answers (`read.ts`) compute the current day's live counts the same way, without storing them.
 *
 * An inquiry counts on its creation day in the zone (a cohort, `(created_at at time zone zone)::date`,
 * right on 23- and 25-hour days); its step record, verifications, checks and signals count on that
 * same day; a case on its own creation day (review H05). Counts only: no row carries an end user's
 * id or a value (rule 11). The definitions are `ANALYTICS_METRICS`' (`@openverify/core`), and the
 * counting keeps `ANALYTICS_RELATIONS` true once a window has settled (the three splits are counted
 * over the inquiries now `completed`).
 */
import { createHash } from 'node:crypto';
import {
  ANALYTICS_FLOW_START_STEP_ID,
  CHECK_ERROR_REASONS,
  CHECK_UNAVAILABLE_REASON_SUFFIX,
  DURATION_BUCKET_COUNT,
  SIGNAL_REGISTRY,
  durationBuckets,
  listMatchCountValue,
  signalBinOf,
  type AnalyticsCaseAssigneeDailyRow,
  type AnalyticsCaseDailyRow,
  type AnalyticsCheckDailyRow,
  type AnalyticsCheckReasonDailyRow,
  type AnalyticsCheckStatus,
  type AnalyticsInquiryDailyRow,
  type AnalyticsInquiryTagDailyRow,
  type AnalyticsPathDailyRow,
  type AnalyticsRollupSource,
  type AnalyticsSignalDailyRow,
  type AnalyticsStepDailyRow,
  type AnalyticsTransitionDailyRow,
  type AnalyticsVerificationDailyRow,
  type AnalyticsVerificationStepDailyRow,
  type FileCaptureMethod,
  type FlowRecordDeviceKind,
  type FlowRecordPlatform,
} from '@openverify/core';
import { STEP_VERIFICATION_TYPES } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { sql, type SQL } from 'drizzle-orm';
// C235.7(c) (Workflow 11A Stage 1b (R), `foundation-11a`'s hook): clones never enter a rollup.
import { notClonedCheck, notClonedVerification } from '../connect/cloned-results.js';

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

/** The rows one computation yields for an inquiry cohort, by table. */
export interface CohortRollups {
  inquiry: AnalyticsInquiryDailyRow[];
  tag: AnalyticsInquiryTagDailyRow[];
  step: AnalyticsStepDailyRow[];
  transition: AnalyticsTransitionDailyRow[];
  path: AnalyticsPathDailyRow[];
  verification: AnalyticsVerificationDailyRow[];
  verificationStep: AnalyticsVerificationStepDailyRow[];
  check: AnalyticsCheckDailyRow[];
  checkReason: AnalyticsCheckReasonDailyRow[];
  signal: AnalyticsSignalDailyRow[];
}

/** The rows one computation yields for the cases created in a range, by table. */
export interface CaseRollups {
  case: AnalyticsCaseDailyRow[];
  assignee: AnalyticsCaseAssigneeDailyRow[];
}

/**
 * Which inquiries a computation counts:
 * - `facts`: every unredacted inquiry created on the days `from` to `to` (local, both included),
 *   less `excludeInquiryIds` (an inquiry whose redaction is under way in this transaction);
 * - `inquiry`: one inquiry, whatever its day (its redacted contribution).
 */
export type CohortSelection =
  | {
      kind: 'facts';
      from: string;
      to: string;
      excludeInquiryIds?: readonly string[];
    }
  | { kind: 'inquiry'; inquiryId: string };

export interface CohortScope {
  environmentId: string;
  /** The IANA zone the days are computed in. */
  timeZone: string;
  selection: CohortSelection;
  /** The `source` the rows are labelled with. */
  source: AnalyticsRollupSource;
}

/**
 * `all` computes every column of every table; `live` only the live counts (C163.4: `created` and
 * `started` of the inquiry rollup, `created` of the tag and case rollups), the other tables empty.
 */
export type RollupColumns = 'all' | 'live';

/** Person-visible steps are the funnel's nodes; branch and action steps are its edges (C164.2). */
const EDGE_STEP_TYPES = ['branch', 'action'] as const;

const histogram = (): number[] => Array.from({ length: DURATION_BUCKET_COUNT }, () => 0);

/** The lower bounds of the duration buckets, for `width_bucket` (the same doubles as core's). */
const DURATION_LOWERS = `{${durationBuckets()
  .map((bucket) => String(bucket.lower))
  .join(',')}}`;

/** A `text[]` of bound parameters. */
function textArray(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`;
}

async function rowsOf<Row extends Record<string, unknown>>(db: Db, query: SQL): Promise<Row[]> {
  const result = await db.execute<Row>(query);
  return (result as { rows: Row[] }).rows;
}

/** The local day of `column` in the scope's zone, as text. */
const localDay = (column: SQL, zone: string): SQL =>
  sql`((${column}) at time zone ${zone})::date::text`;

/** The cohort's inquiries, as a `where` over `inquiries i`. */
function cohortWhere(scope: CohortScope): SQL {
  const { environmentId, timeZone, selection } = scope;
  if (selection.kind === 'inquiry') {
    return sql`i.environment_id = ${environmentId} and i.id = ${selection.inquiryId}`;
  }
  const excluded = selection.excludeInquiryIds ?? [];
  return sql`i.environment_id = ${environmentId}
    and i.created_at >= (${selection.from}::date::timestamp at time zone ${timeZone})
    and i.created_at < ((${selection.to}::date + 1)::timestamp at time zone ${timeZone})
    and i.redacted_at is null
    ${excluded.length === 0 ? sql`` : sql`and i.id <> all(${textArray(excluded)})`}`;
}

const keyOf = (scope: CohortScope, day: string) => ({
  environmentId: scope.environmentId,
  day,
  timeZone: scope.timeZone,
  source: scope.source,
});

// Inquiries ---------------------------------------------------------------------------------------

interface InquiryCountRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  platform: FlowRecordPlatform | null;
  device: FlowRecordDeviceKind | null;
  created: number;
  started: number;
  interacted?: number;
  finished?: number;
  completed?: number;
  completed_verified?: number;
  completed_with_fallback?: number;
  completed_unverified?: number;
  failed?: number;
  expired_before_start?: number;
  expired_after_start?: number;
  approved?: number;
  declined?: number;
  needs_review?: number;
  marked_for_review?: number;
  decided_automatic?: number;
  decided_manual?: number;
  decided_not_declared?: number;
}

/** The flow reached `completed` or `failed` (an expired inquiry is not finished). */
const FINISHED = sql.raw('(i.completed_at is not null or i.failed_at is not null)');

const fallbacks = sql.raw(`coalesce(jsonb_array_length(i.flow_outcome->'fallbacksTaken'), 0)`);
const typesOnPath = sql.raw(
  `coalesce(jsonb_array_length(i.flow_outcome->'verificationTypesOnPath'), 0)`,
);

/** Sent to review at least once: now in review, a review decision, a flag, an attempt in review. */
const MARKED_FOR_REVIEW = sql.raw(`(
  i.status = 'needs_review'
  or coalesce(jsonb_array_length(i.flow_outcome->'flags'), 0) > 0
  or exists (select 1 from inquiry_decisions r where r.environment_id = i.environment_id
    and r.subject_type = 'inquiry' and r.subject_id = i.id and r.kind = 'review')
  or exists (select 1 from verifications rv where rv.environment_id = i.environment_id
    and rv.inquiry_id = i.id and rv.status = 'needs_review')
)`);

function inquiryCounts(scope: CohortScope, columns: RollupColumns): SQL {
  const day = localDay(sql`i.created_at`, scope.timeZone);
  const dims = sql`${day} as day, i.inquiry_template_id as template,
    i.inquiry_template_version_id as version, i.first_platform as platform,
    i.first_device_kind as device`;
  if (columns === 'live') {
    return sql`select ${dims}, count(*)::int as created,
      (count(*) filter (where i.started_at is not null))::int as started
      from inquiries i where ${cohortWhere(scope)} group by 1, 2, 3, 4, 5`;
  }
  const completed = sql`${FINISHED} and i.status = 'completed'`;
  return sql`select ${dims},
    count(*)::int as created,
    (count(*) filter (where i.started_at is not null))::int as started,
    (count(*) filter (where i.started_at is not null and exists (
      select 1 from inquiry_flow_steps s where s.environment_id = i.environment_id
        and s.inquiry_id = i.id and s.seq = 1 and s.exited_at is not null)))::int as interacted,
    (count(*) filter (where ${FINISHED}))::int as finished,
    (count(*) filter (where ${completed}))::int as completed,
    (count(*) filter (where ${completed} and i.flow_outcome is not null and ${fallbacks} = 0
      and ${typesOnPath} > 0))::int as completed_verified,
    (count(*) filter (where ${completed} and i.flow_outcome is not null
      and ${fallbacks} > 0))::int as completed_with_fallback,
    (count(*) filter (where ${completed} and i.flow_outcome is not null and ${fallbacks} = 0
      and ${typesOnPath} = 0))::int as completed_unverified,
    (count(*) filter (where ${FINISHED} and i.status = 'failed'))::int as failed,
    (count(*) filter (where i.status = 'expired' and i.started_at is null))::int
      as expired_before_start,
    (count(*) filter (where i.status = 'expired' and i.started_at is not null
      and not ${FINISHED}))::int as expired_after_start,
    (count(*) filter (where ${FINISHED} and i.status = 'approved'))::int as approved,
    (count(*) filter (where ${FINISHED} and i.status = 'declined'))::int as declined,
    (count(*) filter (where ${FINISHED} and i.status = 'needs_review'))::int as needs_review,
    (count(*) filter (where ${FINISHED} and ${MARKED_FOR_REVIEW}))::int as marked_for_review,
    (count(*) filter (where d.decided = 'automatic'))::int as decided_automatic,
    (count(*) filter (where d.decided = 'manual'))::int as decided_manual,
    (count(*) filter (where d.decided = 'not-declared'))::int as decided_not_declared
    from inquiries i
    left join lateral (
      select case
          when x.solely_automated is true then 'automatic'
          when x.solely_automated is false then 'manual'
          when x.actor_type = 'user' then 'manual'
          when x.actor_type = 'api-key' then 'not-declared'
          else 'automatic'
        end as decided
      from inquiry_decisions x
      where x.environment_id = i.environment_id and x.subject_type = 'inquiry'
        and x.subject_id = i.id and x.kind in ('approve', 'decline', 'flow-failure')
      order by x.created_at desc, x.id desc
      limit 1
    ) d on true
    where ${cohortWhere(scope)}
    group by 1, 2, 3, 4, 5`;
}

function inquiryHistogram(scope: CohortScope): SQL {
  const day = localDay(sql`i.created_at`, scope.timeZone);
  return sql`select ${day} as day, i.inquiry_template_id as template,
    i.inquiry_template_version_id as version, i.first_platform as platform,
    i.first_device_kind as device,
    greatest(width_bucket(extract(epoch from (coalesce(i.completed_at, i.failed_at)
      - i.created_at))::float8, ${DURATION_LOWERS}::float8[]) - 1, 0) as bucket,
    count(*)::int as count
    from inquiries i where ${cohortWhere(scope)} and ${FINISHED}
    group by 1, 2, 3, 4, 5, 6`;
}

const dimsKey = (row: {
  day: string;
  template: string;
  version: string;
  platform: string | null;
  device: string | null;
}) => [row.day, row.template, row.version, row.platform ?? '', row.device ?? ''].join('|');

async function inquiryRows(
  db: Db,
  scope: CohortScope,
  columns: RollupColumns,
): Promise<AnalyticsInquiryDailyRow[]> {
  const counts = await rowsOf<InquiryCountRow>(db, inquiryCounts(scope, columns));
  const rows = new Map<string, Mutable<AnalyticsInquiryDailyRow>>();
  for (const row of counts) {
    rows.set(dimsKey(row), {
      ...keyOf(scope, row.day),
      inquiryTemplateId: row.template,
      inquiryTemplateVersionId: row.version,
      platform: row.platform,
      deviceKind: row.device,
      created: row.created,
      started: row.started,
      interacted: row.interacted ?? 0,
      finished: row.finished ?? 0,
      completed: row.completed ?? 0,
      completedVerified: row.completed_verified ?? 0,
      completedWithFallback: row.completed_with_fallback ?? 0,
      completedUnverified: row.completed_unverified ?? 0,
      failed: row.failed ?? 0,
      expiredBeforeStart: row.expired_before_start ?? 0,
      expiredAfterStart: row.expired_after_start ?? 0,
      approved: row.approved ?? 0,
      declined: row.declined ?? 0,
      needsReview: row.needs_review ?? 0,
      markedForReview: row.marked_for_review ?? 0,
      decidedAutomatic: row.decided_automatic ?? 0,
      decidedManual: row.decided_manual ?? 0,
      decidedNotDeclared: row.decided_not_declared ?? 0,
      finishSecondsHistogram: histogram(),
    });
  }
  if (columns === 'all') {
    const buckets = await rowsOf<
      InquiryCountRow & { bucket: number; count: number } & Record<string, unknown>
    >(db, inquiryHistogram(scope));
    for (const bucket of buckets) {
      const row = rows.get(dimsKey(bucket));
      const counted = row?.finishSecondsHistogram as number[] | undefined;
      if (counted !== undefined) {
        const at = Math.min(bucket.bucket, DURATION_BUCKET_COUNT - 1);
        counted[at] = (counted[at] ?? 0) + bucket.count;
      }
    }
  }
  return [...rows.values()];
}

interface TagRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  platform: FlowRecordPlatform | null;
  device: FlowRecordDeviceKind | null;
  tag: string;
  created: number;
  finished: number;
  completed: number;
  failed: number;
}

async function tagRows(
  db: Db,
  scope: CohortScope,
  columns: RollupColumns,
): Promise<AnalyticsInquiryTagDailyRow[]> {
  const day = localDay(sql`i.created_at`, scope.timeZone);
  const outcomes =
    columns === 'live'
      ? sql`0 as finished, 0 as completed, 0 as failed`
      : sql`(count(*) filter (where ${FINISHED}))::int as finished,
        (count(*) filter (where ${FINISHED} and i.status = 'completed'))::int as completed,
        (count(*) filter (where ${FINISHED} and i.status = 'failed'))::int as failed`;
  const rows = await rowsOf<TagRow>(
    db,
    sql`select ${day} as day, i.inquiry_template_id as template,
      i.inquiry_template_version_id as version, i.first_platform as platform,
      i.first_device_kind as device, t.tag, count(*)::int as created, ${outcomes}
      from inquiries i
      cross join lateral (select distinct x as tag from unnest(i.tags) x
        where char_length(x) between 1 and 128) t
      where ${cohortWhere(scope)}
      group by 1, 2, 3, 4, 5, 6`,
  );
  return rows.map((row) => ({
    ...keyOf(scope, row.day),
    inquiryTemplateId: row.template,
    inquiryTemplateVersionId: row.version,
    platform: row.platform,
    deviceKind: row.device,
    tag: row.tag,
    created: row.created,
    finished: row.finished,
    completed: row.completed,
    failed: row.failed,
  }));
}

// The funnel, from the server's step record (C164.2) ----------------------------------------------

/** The person-visible step entries of the cohort, in order. */
function visibleEntries(scope: CohortScope): SQL {
  const day = localDay(sql`i.created_at`, scope.timeZone);
  return sql`select i.id, ${day} as day, i.inquiry_template_id as template,
      i.inquiry_template_version_id as version, s.step_id, s.seq, s.exited_at
    from inquiries i
    join inquiry_flow_steps s on s.environment_id = i.environment_id and s.inquiry_id = i.id
    where ${cohortWhere(scope)} and s.step_type <> all(${textArray(EDGE_STEP_TYPES)})`;
}

interface StepRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  step_id: string;
  entered: number;
  exited: number;
  revisits: number;
}

interface TransitionRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  from_step_id: string;
  to_step_id: string;
  count: number;
}

interface PathRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  step_ids: string[];
  count: number;
}

/** A path's key: the SHA-256 of its step ids as JSON (the analytics-logic population's). */
export const pathSha256 = (stepIds: readonly string[]): string =>
  createHash('sha256').update(JSON.stringify(stepIds)).digest('hex');

async function funnelRows(
  db: Db,
  scope: CohortScope,
): Promise<Pick<CohortRollups, 'step' | 'transition' | 'path'>> {
  const entries = visibleEntries(scope);
  const steps = await rowsOf<StepRow>(
    db,
    sql`with e as (${entries}),
      per as (select id, day, template, version, step_id, count(*) as entries,
        bool_or(exited_at is not null) as exited from e group by 1, 2, 3, 4, 5)
      select day, template, version, step_id, count(*)::int as entered,
        (count(*) filter (where exited))::int as exited,
        (count(*) filter (where entries > 1))::int as revisits
      from per group by 1, 2, 3, 4`,
  );
  const transitions = await rowsOf<TransitionRow>(
    db,
    sql`with e as (${entries}),
      moves as (select day, template, version,
        coalesce(lag(step_id) over (partition by id order by seq),
          ${ANALYTICS_FLOW_START_STEP_ID}) as from_step_id, step_id as to_step_id
        from e)
      select day, template, version, from_step_id, to_step_id, count(*)::int as count
      from moves group by 1, 2, 3, 4, 5`,
  );
  const paths = await rowsOf<PathRow>(
    db,
    sql`with e as (${entries}),
      walked as (select day, template, version, array_agg(step_id order by seq) as step_ids
        from e group by id, day, template, version)
      select day, template, version, step_ids, count(*)::int as count
      from walked group by 1, 2, 3, 4`,
  );
  const version = (row: { template: string; version: string }) => ({
    inquiryTemplateId: row.template,
    inquiryTemplateVersionId: row.version,
  });
  return {
    step: steps.map((row) => ({
      ...keyOf(scope, row.day),
      ...version(row),
      stepId: row.step_id,
      entered: row.entered,
      exited: row.exited,
      revisits: row.revisits,
    })),
    transition: transitions.map((row) => ({
      ...keyOf(scope, row.day),
      ...version(row),
      fromStepId: row.from_step_id,
      toStepId: row.to_step_id,
      count: row.count,
    })),
    path: paths.map((row) => ({
      ...keyOf(scope, row.day),
      ...version(row),
      pathSha256: pathSha256(row.step_ids),
      stepIds: row.step_ids,
      count: row.count,
    })),
  };
}

// Verifications (C164.3) --------------------------------------------------------------------------

interface VerificationRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  type: string;
  capture_method: FileCaptureMethod | null;
  country: string | null;
  created: number;
  submitted: number;
  passed: number;
  failed: number;
  requires_retry: number;
  skipped: number;
  needs_review: number;
  canceled: number;
}

interface VerificationStepRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  step_id: string;
  type: string;
  entered: number;
  passed: number;
  failed_after_attempts: number;
  needs_review: number;
  skipped: number;
}

/** The step types that create a verification, with the type each creates (C50.2). */
const STEP_TYPE_MAP: SQL = sql.raw(
  `(values ${Object.entries(STEP_VERIFICATION_TYPES)
    .flatMap(([step, type]) => (type === null ? [] : [`('${step}', '${type}')`]))
    .join(', ')}) as m(step_type, verification_type)`,
);

async function verificationRows(
  db: Db,
  scope: CohortScope,
): Promise<Pick<CohortRollups, 'verification' | 'verificationStep'>> {
  const day = localDay(sql`i.created_at`, scope.timeZone);
  const attempts = await rowsOf<VerificationRow>(
    db,
    sql`select ${day} as day, i.inquiry_template_id as template,
      i.inquiry_template_version_id as version, v.type::text as type,
      (select f.capture_method from files f where f.environment_id = v.environment_id
        and f.verification_id = v.id and f.capture_method is not null
        order by f.created_at, f.id limit 1) as capture_method,
      case when v.type = 'government_id' and v.country ~ '^[A-Z]{2}$' then v.country end as country,
      count(*)::int as created,
      (count(*) filter (where v.status in ('submitted', 'passed', 'failed', 'requires_retry',
        'needs_review')))::int as submitted,
      (count(*) filter (where v.status = 'passed'))::int as passed,
      (count(*) filter (where v.status = 'failed'))::int as failed,
      (count(*) filter (where v.status = 'requires_retry'))::int as requires_retry,
      (count(*) filter (where v.status = 'skipped'))::int as skipped,
      (count(*) filter (where v.status = 'needs_review'))::int as needs_review,
      (count(*) filter (where v.status = 'canceled'))::int as canceled
      from inquiries i
      join verifications v on v.environment_id = i.environment_id and v.inquiry_id = i.id
      where ${cohortWhere(scope)} and ${notClonedVerification('v')}
      group by 1, 2, 3, 4, 5, 6`,
  );
  // The outcome of the step's last sent attempt of its type that the flow created (C151.4, H06).
  const steps = await rowsOf<VerificationStepRow>(
    db,
    sql`with e as (
        select distinct i.id, i.environment_id, ${day} as day, i.inquiry_template_id as template,
          i.inquiry_template_version_id as version, s.step_id, m.verification_type
        from inquiries i
        join inquiry_flow_steps s on s.environment_id = i.environment_id and s.inquiry_id = i.id
        join ${STEP_TYPE_MAP} on m.step_type = s.step_type
        where ${cohortWhere(scope)})
      select e.day, e.template, e.version, e.step_id, e.verification_type as type,
        count(*)::int as entered,
        (count(*) filter (where last.status = 'passed'))::int as passed,
        (count(*) filter (where last.status in ('failed', 'requires_retry')))::int
          as failed_after_attempts,
        (count(*) filter (where last.status = 'needs_review'))::int as needs_review,
        (count(*) filter (where last.status = 'skipped'))::int as skipped
      from e
      left join lateral (
        select v.status from verifications v
        where v.environment_id = e.environment_id and v.inquiry_id = e.id
          and v.type::text = e.verification_type and v.workflow_run_step_id is null
          and v.status not in ('initiated', 'confirmed') and ${notClonedVerification('v')}
        order by v.created_at desc, v.id desc limit 1
      ) last on true
      group by 1, 2, 3, 4, 5`,
  );
  return {
    verification: attempts.map((row) => ({
      ...keyOf(scope, row.day),
      inquiryTemplateId: row.template,
      inquiryTemplateVersionId: row.version,
      verificationType: row.type,
      captureMethod: row.capture_method,
      country: row.country,
      created: row.created,
      submitted: row.submitted,
      passed: row.passed,
      failed: row.failed,
      requiresRetry: row.requires_retry,
      skipped: row.skipped,
      needsReview: row.needs_review,
      canceled: row.canceled,
    })),
    verificationStep: steps.map((row) => ({
      ...keyOf(scope, row.day),
      inquiryTemplateId: row.template,
      inquiryTemplateVersionId: row.version,
      stepId: row.step_id,
      verificationType: row.type,
      entered: row.entered,
      passed: row.passed,
      failedAfterAttempts: row.failed_after_attempts,
      needsReview: row.needs_review,
      skipped: row.skipped,
    })),
  };
}

// Checks (C164.4; review H03) ---------------------------------------------------------------------

/** An outage reason: one of `CHECK_ERROR_REASONS`, or any reason ending `_unavailable`. */
const outage = (reason: SQL, without?: string): SQL => {
  const reasons = CHECK_ERROR_REASONS.filter((code) => code !== without);
  return sql`(${reason} = any(${textArray(reasons)})
    or right(${reason}, ${CHECK_UNAVAILABLE_REASON_SUFFIX.length}) = ${CHECK_UNAVAILABLE_REASON_SUFFIX})`;
};

/**
 * The rollup status of a check result (`checkErrorClassOf`): a `not_applicable` result with an outage
 * reason is `errored`, or `not_configured` when `provider_not_configured` is its only one.
 */
const CHECK_STATUS: SQL = sql`case
    when c.status = 'not_applicable'
      and exists (select 1 from unnest(c.reasons) r(reason) where ${outage(sql`r.reason`)})
    then case
      when exists (select 1 from unnest(c.reasons) r(reason)
        where ${outage(sql`r.reason`, 'provider_not_configured')})
      then 'errored' else 'not_configured' end
    else c.status::text
  end`;

interface CheckRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  type: string;
  name: string;
  requirement: 'required' | 'not_required';
  status: AnalyticsCheckStatus;
  count: number;
}

interface ReasonRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  type: string;
  requirement: 'required' | 'not_required';
  name: string;
  reason: string;
  count: number;
}

async function checkRows(
  db: Db,
  scope: CohortScope,
): Promise<Pick<CohortRollups, 'check' | 'checkReason'>> {
  const day = localDay(sql`i.created_at`, scope.timeZone);
  const from = sql`from inquiries i
    join verifications v on v.environment_id = i.environment_id and v.inquiry_id = i.id
    join verification_checks c on c.environment_id = v.environment_id and c.verification_id = v.id
    where ${cohortWhere(scope)} and ${notClonedVerification('v')} and ${notClonedCheck('c')}`;
  const results = await rowsOf<CheckRow>(
    db,
    sql`select ${day} as day, i.inquiry_template_id as template,
      i.inquiry_template_version_id as version, v.type::text as type, c.name,
      c.requirement::text as requirement, ${CHECK_STATUS} as status, count(*)::int as count
      ${from} group by 1, 2, 3, 4, 5, 6, 7`,
  );
  // Each result's distinct reasons; a reason longer than the rollup's bound is left out.
  const reasons = await rowsOf<ReasonRow>(
    db,
    sql`select ${day} as day, i.inquiry_template_id as template,
      i.inquiry_template_version_id as version, v.type::text as type, c.name,
      c.requirement::text as requirement, r.reason, count(*)::int as count
      from inquiries i
      join verifications v on v.environment_id = i.environment_id and v.inquiry_id = i.id
      join verification_checks c on c.environment_id = v.environment_id
        and c.verification_id = v.id
      cross join lateral (select distinct x as reason from unnest(c.reasons) x
        where char_length(x) between 1 and 128) r
      where ${cohortWhere(scope)} and ${notClonedVerification('v')} and ${notClonedCheck('c')}
      group by 1, 2, 3, 4, 5, 6, 7`,
  );
  return {
    check: results.map((row) => ({
      ...keyOf(scope, row.day),
      inquiryTemplateId: row.template,
      inquiryTemplateVersionId: row.version,
      verificationType: row.type,
      checkName: row.name,
      requirement: row.requirement,
      status: row.status,
      count: row.count,
    })),
    checkReason: reasons.map((row) => ({
      ...keyOf(scope, row.day),
      inquiryTemplateId: row.template,
      inquiryTemplateVersionId: row.version,
      verificationType: row.type,
      checkName: row.name,
      requirement: row.requirement,
      reason: row.reason,
      count: row.count,
    })),
  };
}

// Signals (C164.6) ----------------------------------------------------------------------------------

/** The stored signals' names; `list_match_count` is read from the list screening instead (B13). */
const LIST_MATCH_COUNT = 'inquiry/list_match_count';
const STORED_SIGNALS = SIGNAL_REGISTRY.map((signal) => signal.name).filter(
  (name) => name !== LIST_MATCH_COUNT,
);
/** Distances are binned in whole kilometres, so a value is grouped by its kilometre. */
const METRE_SIGNALS = SIGNAL_REGISTRY.filter((signal) => signal.unit === 'meters').map(
  (signal) => signal.name,
);

interface SignalValueRow extends Record<string, unknown> {
  day: string;
  template: string;
  version: string;
  platform: FlowRecordPlatform | null;
  device: FlowRecordDeviceKind | null;
  name: string;
  value: string | null;
  count: number;
}

/** What a signal pass could not bin (a value outside its bins); logged by name only. */
export interface SignalBinFailure {
  name: string;
  count: number;
}

async function signalRows(
  db: Db,
  scope: CohortScope,
  onUnbinned: (failure: SignalBinFailure) => void,
): Promise<AnalyticsSignalDailyRow[]> {
  const day = localDay(sql`i.created_at`, scope.timeZone);
  const dims = sql`${day} as day, i.inquiry_template_id as template,
    i.inquiry_template_version_id as version, i.first_platform as platform,
    i.first_device_kind as device`;
  // Every inquiry counts once per signal: a signal not written (yet) is not evaluated.
  const values = await rowsOf<SignalValueRow>(
    db,
    sql`select ${dims}, n.name,
        case when n.name = any(${textArray(METRE_SIGNALS)}) and jsonb_typeof(x.value) = 'number'
          then ((floor((x.value)::text::numeric / 1000) * 1000)::bigint)::text
          else x.value::text end as value,
        count(*)::int as count
      from inquiries i
      cross join unnest(${textArray(STORED_SIGNALS)}) n(name)
      left join lateral (
        select e->'value' as value from jsonb_array_elements(
          case when jsonb_typeof(i.signals) = 'array' then i.signals else '[]'::jsonb end) e
        where e->>'name' = n.name limit 1
      ) x on true
      where ${cohortWhere(scope)}
      group by 1, 2, 3, 4, 5, 6, 7
      union all
      select ${dims}, ${LIST_MATCH_COUNT} as name,
        case when ls.status = 'completed' then ls.match_count::text end as value,
        count(*)::int as count
      from inquiries i
      left join list_screenings ls on ls.environment_id = i.environment_id and ls.inquiry_id = i.id
      where ${cohortWhere(scope)}
      group by 1, 2, 3, 4, 5, 6, 7`,
  );
  const rows = new Map<string, Mutable<AnalyticsSignalDailyRow>>();
  const unbinned = new Map<string, number>();
  for (const row of values) {
    let bin: string;
    try {
      const value: unknown = row.value === null ? null : JSON.parse(row.value);
      bin =
        row.name === LIST_MATCH_COUNT
          ? signalBinOf(
              row.name,
              listMatchCountValue(
                value === null ? null : { status: 'completed', matchCount: Number(value) },
              ),
            )
          : signalBinOf(row.name, value);
    } catch {
      // Never counted as another bin or as not evaluated: left out, and counted by name.
      unbinned.set(row.name, (unbinned.get(row.name) ?? 0) + row.count);
      continue;
    }
    const key = [dimsKey(row), row.name, bin].join('|');
    const existing = rows.get(key);
    if (existing === undefined) {
      rows.set(key, {
        ...keyOf(scope, row.day),
        inquiryTemplateId: row.template,
        inquiryTemplateVersionId: row.version,
        platform: row.platform,
        deviceKind: row.device,
        signalName: row.name,
        bin,
        count: row.count,
      });
    } else {
      existing.count += row.count;
    }
  }
  for (const [name, count] of unbinned) {
    onUnbinned({ name, count });
  }
  return [...rows.values()];
}

// Cases (C164.5; review P20) -----------------------------------------------------------------------

export interface CaseScope {
  environmentId: string;
  timeZone: string;
  from: string;
  to: string;
}

interface CaseRow extends Record<string, unknown> {
  day: string;
  template: string;
  created: number;
  resolved: number;
  sla_met: number;
  sla_missed: number;
}

interface CaseBucketRow extends Record<string, unknown> {
  day: string;
  template: string;
  bucket: number;
  count: number;
}

interface AssigneeRow extends Record<string, unknown> {
  day: string;
  template: string;
  user_id: string;
  assigned: number;
  resolved: number;
}

/**
 * The case rollups of the cases created on the days `from` to `to` (each on its own creation day).
 * Cases hold no end user's data in these columns, so a case's redaction leaves its counts.
 */
export async function computeCaseRollups(
  db: Db,
  scope: CaseScope,
  columns: RollupColumns,
): Promise<CaseRollups> {
  const day = localDay(sql`c.created_at`, scope.timeZone);
  const where = sql`c.environment_id = ${scope.environmentId}
    and c.created_at >= (${scope.from}::date::timestamp at time zone ${scope.timeZone})
    and c.created_at < ((${scope.to}::date + 1)::timestamp at time zone ${scope.timeZone})`;
  const outcomes =
    columns === 'live'
      ? sql`0 as resolved, 0 as sla_met, 0 as sla_missed`
      : sql`(count(*) filter (where c.resolved_at is not null))::int as resolved,
        (count(*) filter (where c.resolved_at is not null and c.sla_met_at is not null))::int
          as sla_met,
        (count(*) filter (where c.sla_expired_at is not null))::int as sla_missed`;
  const counted = await rowsOf<CaseRow>(
    db,
    sql`select ${day} as day, c.case_template_id as template, count(*)::int as created, ${outcomes}
      from cases c where ${where} group by 1, 2`,
  );
  const key = (row: { day: string; template: string }) => `${row.day}|${row.template}`;
  const cases = new Map<string, Mutable<AnalyticsCaseDailyRow>>();
  for (const row of counted) {
    cases.set(key(row), {
      environmentId: scope.environmentId,
      day: row.day,
      timeZone: scope.timeZone,
      source: 'facts',
      caseTemplateId: row.template,
      created: row.created,
      resolved: row.resolved,
      slaMet: row.sla_met,
      slaMissed: row.sla_missed,
      resolutionSecondsHistogram: histogram(),
    });
  }
  if (columns === 'live') {
    return { case: [...cases.values()], assignee: [] };
  }
  const buckets = await rowsOf<CaseBucketRow>(
    db,
    sql`select ${day} as day, c.case_template_id as template,
      greatest(width_bucket(extract(epoch from (c.resolved_at - c.created_at))::float8,
        ${DURATION_LOWERS}::float8[]) - 1, 0) as bucket,
      count(*)::int as count
      from cases c where ${where} and c.resolved_at is not null group by 1, 2, 3`,
  );
  for (const bucket of buckets) {
    const counts = cases.get(key(bucket))?.resolutionSecondsHistogram as number[] | undefined;
    if (counts !== undefined) {
      const at = Math.min(bucket.bucket, DURATION_BUCKET_COUNT - 1);
      counts[at] = (counts[at] ?? 0) + bucket.count;
    }
  }
  // The current assignee, an operator (review P20); an assignee no longer a user is left out.
  const assignees = await rowsOf<AssigneeRow>(
    db,
    sql`select ${day} as day, c.case_template_id as template, c.assignee_id as user_id,
      count(*)::int as assigned,
      (count(*) filter (where c.resolved_at is not null))::int as resolved
      from cases c join users u on u.id = c.assignee_id
      where ${where} group by 1, 2, 3`,
  );
  return {
    case: [...cases.values()],
    assignee: assignees.map((row) => ({
      environmentId: scope.environmentId,
      day: row.day,
      timeZone: scope.timeZone,
      source: 'facts',
      caseTemplateId: row.template,
      userId: row.user_id,
      assigned: row.assigned,
      resolved: row.resolved,
    })),
  };
}

// The cohort ---------------------------------------------------------------------------------------

const EMPTY_COHORT = (): CohortRollups => ({
  inquiry: [],
  tag: [],
  step: [],
  transition: [],
  path: [],
  verification: [],
  verificationStep: [],
  check: [],
  checkReason: [],
  signal: [],
});

/**
 * The inquiry cohort's rows, every table (`all`) or the live counts only (`live`). `onUnbinned`
 * hears of signal values outside their bins, which are never counted as another bin.
 */
export async function computeCohortRollups(
  db: Db,
  scope: CohortScope,
  columns: RollupColumns,
  onUnbinned: (failure: SignalBinFailure) => void = () => undefined,
): Promise<CohortRollups> {
  const rollups = EMPTY_COHORT();
  rollups.inquiry = await inquiryRows(db, scope, columns);
  rollups.tag = await tagRows(db, scope, columns);
  if (columns === 'live' || rollups.inquiry.length === 0) {
    return rollups;
  }
  Object.assign(rollups, await funnelRows(db, scope));
  Object.assign(rollups, await verificationRows(db, scope));
  Object.assign(rollups, await checkRows(db, scope));
  rollups.signal = await signalRows(db, scope, onUnbinned);
  return rollups;
}
