/**
 * C74.1: report runs: the fenced claim, its release and expiry, completion and the final failure,
 * the budget wait, and the sweep's batches (C74.3).
 *
 * Claims are fenced (P11, V02): a worker claims a run with one conditional update that sets a
 * fresh `claimed_by` token, and every later write of that worker matches the token and `running`,
 * so a worker whose claim expired and was taken over writes nothing.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3), who adds every function this file needs. The file
 * and its export line in `repositories/index.ts` are frozen by `foundation-6` (Stage 1b).
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { reportRuns, reports, type ReportRunRow } from '../schema.js';
import { firstOrNull, inserted, textArray } from './rows.js';

/** The owner of this repository file. */
export const REPORT_RUNS_REPOSITORY_OWNER = 'api-reports';

export type ReportRunTypeValue = ReportRunRow['runType'];
export type ReportRunStatusValue = ReportRunRow['status'];

export interface NewReportRunInput {
  id: string;
  reportId: string;
  runType: Exclude<ReportRunTypeValue, 'list_update'>;
  scheduledFor: Date;
}

export interface ReportRunClaim {
  /** The fresh claim token (worker id and attempt). */
  token: string;
  now: Date;
  /** `claimed_until`: now plus the claim's lease (10 minutes, C74.1). */
  claimedUntil: Date;
}

/** What a run's completion (or final failure) writes, fenced by its claim. */
export interface ReportRunOutcome {
  status: 'ready' | 'errored';
  completedAt: Date;
  matchCount: number;
  newMatchCount: number;
  sources: readonly Record<string, unknown>[];
  coverage: { complete: boolean; limits: readonly string[] } | null;
  errors: readonly { code: string; source?: string }[];
  notes: readonly string[];
}

/** A run the sweep enqueued (C74.3 (a)). */
export interface EnqueuedReportRun {
  environmentId: string;
  reportId: string;
  runId: string;
}

/** A recurring report the sweep found due (C74.3 (b)). */
export interface DueRecurringReport {
  environmentId: string;
  reportId: string;
  nextRunAt: Date;
  recurrenceIntervalDays: number;
}

const runIn = (environmentId: string, id: string) =>
  and(eq(reportRuns.environmentId, environmentId), eq(reportRuns.id, id));

/** The run is held by `token` (C74.1's fence). */
const heldBy = (token: string) =>
  and(eq(reportRuns.claimedBy, token), eq(reportRuns.status, 'running'));

/** The run's report is not redacted. */
const reportNotRedacted = sql`exists (
    select 1 from ${reports}
     where ${reports.environmentId} = ${reportRuns.environmentId}
       and ${reports.id} = ${reportRuns.reportId}
       and ${reports.redactedAt} is null)`;

/** C74.1: pending and due, or running with an expired claim. */
const claimable = (now: Date) =>
  or(
    and(
      eq(reportRuns.status, 'pending'),
      or(isNull(reportRuns.notBefore), lte(reportRuns.notBefore, now)),
    ),
    and(eq(reportRuns.status, 'running'), lt(reportRuns.claimedUntil, now)),
  );

/** Inserts a pending run (`initial`, `scheduled` or `manual`). */
export async function insertReportRun(
  db: Db,
  environmentId: string,
  input: NewReportRunInput,
): Promise<ReportRunRow> {
  return inserted(
    await db
      .insert(reportRuns)
      .values({
        id: input.id,
        environmentId,
        reportId: input.reportId,
        runType: input.runType,
        status: 'pending',
        scheduledFor: input.scheduledFor,
        createdAt: input.scheduledFor,
      })
      .returning(),
    'insertReportRun',
  );
}

export async function getReportRun(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ReportRunRow | null> {
  return firstOrNull(await db.select().from(reportRuns).where(runIn(environmentId, id)));
}

/** The report's runs, newest first (C74.2). */
export async function listReportRuns(
  db: Db,
  environmentId: string,
  reportId: string,
): Promise<ReportRunRow[]> {
  return db
    .select()
    .from(reportRuns)
    .where(and(eq(reportRuns.environmentId, environmentId), eq(reportRuns.reportId, reportId)))
    .orderBy(desc(reportRuns.createdAt), desc(reportRuns.id));
}

/**
 * C74.1: claims the run with one conditional update: `pending` and due (`not_before` null or
 * past), or `running` with an expired claim, of an unredacted report. Sets `running`, the token,
 * `claimed_until`, `started_at` and `attempt + 1`. `null` when there is nothing to claim.
 */
export async function claimReportRun(
  db: Db,
  environmentId: string,
  id: string,
  claim: ReportRunClaim,
): Promise<ReportRunRow | null> {
  return firstOrNull(
    await db
      .update(reportRuns)
      .set({
        status: 'running',
        claimedBy: claim.token,
        claimedUntil: claim.claimedUntil,
        startedAt: claim.now,
        notBefore: null,
        attempt: sql`${reportRuns.attempt} + 1`,
      })
      .where(and(runIn(environmentId, id), claimable(claim.now), reportNotRedacted))
      .returning(),
  );
}

/** C74.1: a retryable error gives the claim back (`pending`, claim cleared), fenced by `token`. */
export async function releaseReportRunClaim(
  db: Db,
  environmentId: string,
  id: string,
  token: string,
): Promise<boolean> {
  const rows = await db
    .update(reportRuns)
    .set({ status: 'pending', claimedBy: null, claimedUntil: null })
    .where(and(runIn(environmentId, id), heldBy(token)))
    .returning({ id: reportRuns.id });
  return rows.length > 0;
}

/**
 * C74.1, C81.2: a budget wait: back to `pending` with `not_before`, the claim released without
 * counting it (`attempt - 1`) and `enqueued_at` cleared, fenced by `token`.
 */
export async function deferReportRun(
  db: Db,
  environmentId: string,
  id: string,
  token: string,
  notBefore: Date,
): Promise<boolean> {
  const rows = await db
    .update(reportRuns)
    .set({
      status: 'pending',
      claimedBy: null,
      claimedUntil: null,
      enqueuedAt: null,
      notBefore,
      attempt: sql`greatest(${reportRuns.attempt} - 1, 0)`,
    })
    .where(and(runIn(environmentId, id), heldBy(token)))
    .returning({ id: reportRuns.id });
  return rows.length > 0;
}

/**
 * C74.1: completes (or finally fails) the run, `WHERE claimed_by = token AND status = 'running'`.
 * `false` when the claim was lost: the caller then writes nothing else.
 */
export async function finishReportRun(
  db: Db,
  environmentId: string,
  id: string,
  token: string,
  outcome: ReportRunOutcome,
): Promise<boolean> {
  const rows = await db
    .update(reportRuns)
    .set({
      status: outcome.status,
      completedAt: outcome.completedAt,
      claimedUntil: null,
      matchCount: outcome.matchCount,
      newMatchCount: outcome.newMatchCount,
      sources: outcome.sources.map((source) => ({ ...source })),
      coverage:
        outcome.coverage === null
          ? null
          : { complete: outcome.coverage.complete, limits: [...outcome.coverage.limits] },
      errors: outcome.errors.map((error) => ({ ...error })),
      // Notes written before the run completed (`recurring_limit` at creation) are kept.
      notes: sql`array(select distinct unnest(${reportRuns.notes} || ${textArray(outcome.notes)}) order by 1)`,
    })
    .where(and(runIn(environmentId, id), heldBy(token)))
    .returning({ id: reportRuns.id });
  return rows.length > 0;
}

/** Adds codes to a run's notes (an `on-report-match` cause, C84.3). */
export async function addReportRunNotes(
  db: Db,
  environmentId: string,
  id: string,
  notes: readonly string[],
): Promise<void> {
  if (notes.length === 0) {
    return;
  }
  await db
    .update(reportRuns)
    .set({
      notes: sql`array(select distinct unnest(${reportRuns.notes} || ${textArray(notes)}) order by 1)`,
    })
    .where(runIn(environmentId, id));
}

/** C74.3 (b): whether the report has a `pending` or `running` scheduled run. */
export async function hasOpenScheduledRun(
  db: Db,
  environmentId: string,
  reportId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: reportRuns.id })
    .from(reportRuns)
    .where(
      and(
        eq(reportRuns.environmentId, environmentId),
        eq(reportRuns.reportId, reportId),
        eq(reportRuns.runType, 'scheduled'),
        inArray(reportRuns.status, ['pending', 'running']),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * C74.3 (a): up to `limit` claimable runs of unredacted reports whose `enqueued_at` is null or
 * before `enqueuedBefore`, locked with `SKIP LOCKED`, stamped `enqueued_at = now` in the caller's
 * transaction. Install-wide, but fair (R001): each environment in turn, its `n`-th run before any
 * environment's `n + 1`-th, so one environment's backlog never keeps another's runs out of a
 * batch. Within an environment, runs not waiting on a budget (`not_before` null) come before its
 * budget-waiting ones, so its own completion, scheduled and re-screen runs are not held behind
 * them; then oldest `scheduled_for` first.
 */
export async function stampEnqueueableReportRuns(
  db: Db,
  options: { now: Date; enqueuedBefore: Date; limit: number },
): Promise<EnqueuedReportRun[]> {
  const enqueueable = and(
    inArray(reportRuns.status, ['pending', 'running']),
    claimable(options.now),
    or(isNull(reportRuns.enqueuedAt), lt(reportRuns.enqueuedAt, options.enqueuedBefore)),
    reportNotRedacted,
  );
  const ranked = db
    .select({
      id: reportRuns.id,
      turn: sql<number>`row_number() over (
          partition by ${reportRuns.environmentId}
          order by ${reportRuns.notBefore} is not null, ${reportRuns.scheduledFor}, ${reportRuns.id})`.as(
        'turn',
      ),
    })
    .from(reportRuns)
    .where(enqueueable)
    .as('ranked');
  const due = await db
    .select({ id: reportRuns.id, turn: ranked.turn })
    .from(reportRuns)
    .innerJoin(ranked, eq(ranked.id, reportRuns.id))
    // Checked again on the locked row, so a run another sweep took meanwhile is left out.
    .where(enqueueable)
    .orderBy(asc(ranked.turn), asc(reportRuns.scheduledFor), asc(reportRuns.id))
    .limit(options.limit)
    .for('update', { of: reportRuns, skipLocked: true });
  if (due.length === 0) {
    return [];
  }
  const order = new Map(due.map((row, index) => [row.id, index]));
  const stamped = await db
    .update(reportRuns)
    .set({ enqueuedAt: options.now })
    .where(
      inArray(
        reportRuns.id,
        due.map((row) => row.id),
      ),
    )
    .returning({
      environmentId: reportRuns.environmentId,
      reportId: reportRuns.reportId,
      runId: reportRuns.id,
      scheduledFor: reportRuns.scheduledFor,
    });
  return stamped
    .sort((a, b) => (order.get(a.runId) ?? 0) - (order.get(b.runId) ?? 0))
    .map(({ environmentId, reportId, runId }) => ({ environmentId, reportId, runId }));
}

/** C74.1: clears `enqueued_at` after a failed enqueue, so the next sweep tries again. */
export async function clearReportRunEnqueued(
  db: Db,
  environmentId: string,
  id: string,
): Promise<void> {
  await db.update(reportRuns).set({ enqueuedAt: null }).where(runIn(environmentId, id));
}

/**
 * C74.3 (b): up to `limit` recurring reports due at `now` (not paused, not redacted), locked with
 * `SKIP LOCKED` in the caller's transaction. Install-wide.
 */
export async function lockDueRecurringReports(
  db: Db,
  options: { now: Date; limit: number },
): Promise<DueRecurringReport[]> {
  const rows = await db
    .select({
      environmentId: reports.environmentId,
      reportId: reports.id,
      nextRunAt: reports.nextRunAt,
      recurrenceIntervalDays: reports.recurrenceIntervalDays,
    })
    .from(reports)
    .where(
      and(
        isNotNull(reports.nextRunAt),
        lte(reports.nextRunAt, options.now),
        isNull(reports.pausedAt),
        isNull(reports.redactedAt),
        isNotNull(reports.recurrenceIntervalDays),
      ),
    )
    .orderBy(asc(reports.nextRunAt), asc(reports.id))
    .limit(options.limit)
    .for('update', { skipLocked: true });
  return rows.flatMap((row) =>
    row.nextRunAt === null || row.recurrenceIntervalDays === null
      ? []
      : [
          {
            environmentId: row.environmentId,
            reportId: row.reportId,
            nextRunAt: row.nextRunAt,
            recurrenceIntervalDays: row.recurrenceIntervalDays,
          },
        ],
  );
}
