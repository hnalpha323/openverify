/**
 * C163.2, C163.4 (Workflow 9B, `api-analytics`; decisions 36 and 72, reviews H04, H28, P21): the
 * refresh of one environment's rollups, which the `analytics-rollup` pass runs every 5 minutes and
 * the `analytics-rebuild` job after a zone change.
 *
 * - **The watermark** is `now() - 2 minutes` (timestamps are not commit-ordered). Every local day
 *   before the watermark's day is stored; that day and later are the current day, computed live by
 *   the answers and never stored (H28).
 * - **New days**: a day the previous pass still saw as current is stored with every column.
 * - **Open days** (`analytics-settle-days`, H04): a day is recomputed only while it is within the
 *   settle window of today; after that it is frozen, and the state records the last closed day
 *   (`closed_through`, K9-24): a raised window never reopens it. Each pass refreshes only the live counts
 *   (`created`, `started`) of the open days with an inquiry, verification, check or case updated
 *   since the last watermark (the dirty days, through the `updated_at` indexes); the first pass after
 *   the zone's midnight recomputes every column of every open day (P21), and records it as
 *   `outcomes-as-of`.
 * - **The first pass** builds every day back to `analytics-retention-months`.
 * - **A zone change** (C163.2): the state's zone differs from the setting, so the pass hands the
 *   environment to `analytics-rebuild`, which recomputes the open days only in the new zone; closed
 *   days and every `redacted` row keep the zone they were computed in.
 *
 * Each batch of days is deleted and inserted again in one transaction under the environment's
 * analytics lock, so a rerun is harmless and a redaction never interleaves.
 */
import type { Db } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { addDays, daysFrom, laterDay, localDayOf, monthsBefore } from './days.js';
import {
  computeCaseRollups,
  computeCohortRollups,
  type RollupColumns,
  type SignalBinFailure,
} from './rollup-sql.js';
import {
  firstStepDay,
  readAnalyticsState,
  writeAnalyticsState,
  type AnalyticsEnvironment,
  type AnalyticsState,
} from './state.js';
import { lockAnalyticsInTx, replaceFactsInTx } from './store.js';

/** C163.4: the watermark trails the clock by 2 minutes (timestamps are not commit-ordered). */
export const ANALYTICS_WATERMARK_LAG_MS = 120_000;

/**
 * Days recomputed per transaction (ours, provisional: a week of a busy environment, a few thousand
 * inquiries, keeps each transaction to seconds while the build covers 400 days).
 */
export const ANALYTICS_DAYS_PER_TRANSACTION = 7;

export interface RefreshLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

export interface RefreshOptions {
  now: Date;
  logger?: RefreshLogger;
}

/** What one environment's refresh did. */
export interface EnvironmentRefresh {
  /** Days recomputed with every column. */
  fullDays: number;
  /** Days whose live counts were refreshed. */
  liveDays: number;
  /** The state's zone differs from the setting: the environment waits for a rebuild. */
  rebuildNeeded: boolean;
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
};

/** Contiguous runs of days, so one computation covers a run's range. */
function runsOf(days: readonly string[]): string[][] {
  const runs: string[][] = [];
  for (const day of [...new Set(days)].sort()) {
    const last = runs[runs.length - 1];
    if (last !== undefined && addDays(last[last.length - 1] ?? day, 1) === day) {
      last.push(day);
    } else {
      runs.push([day]);
    }
  }
  return runs;
}

function warnUnbinned(logger: RefreshLogger | undefined, environmentId: string) {
  return (failure: SignalBinFailure) =>
    logger?.warn(
      { environmentId, signal: failure.name, count: failure.count },
      'analytics: signal values outside their bins were left out',
    );
}

/**
 * Recomputes `days` of one environment in `zone`, each batch in one transaction: every column
 * (`all`) or the live counts (`live`). `excludeInquiryIds` leaves out inquiries whose redaction is
 * under way in the caller's transaction (`tx` given: one transaction, no batching).
 */
export async function recomputeDays(
  db: Db,
  input: {
    environmentId: string;
    zone: string;
    days: readonly string[];
    columns: RollupColumns;
    logger?: RefreshLogger | undefined;
    excludeInquiryIds?: readonly string[];
    tx?: Db;
  },
): Promise<number> {
  const { environmentId, zone, columns } = input;
  const recompute = async (tx: Db, run: readonly string[]) => {
    const from = run[0] ?? '';
    const to = run[run.length - 1] ?? '';
    const cohort = await computeCohortRollups(
      tx,
      {
        environmentId,
        timeZone: zone,
        source: 'facts',
        selection: {
          kind: 'facts',
          from,
          to,
          ...(input.excludeInquiryIds === undefined
            ? {}
            : { excludeInquiryIds: input.excludeInquiryIds }),
        },
      },
      columns,
      warnUnbinned(input.logger, environmentId),
    );
    const cases = await computeCaseRollups(
      tx,
      { environmentId, timeZone: zone, from, to },
      columns,
    );
    await replaceFactsInTx(tx, { environmentId, days: run, columns, cohort, cases });
  };
  const batches = runsOf(input.days).flatMap((run) => chunks(run, ANALYTICS_DAYS_PER_TRANSACTION));
  for (const batch of batches) {
    if (input.tx === undefined) {
      await db.transaction(async (tx) => {
        await lockAnalyticsInTx(tx, environmentId);
        await recompute(tx, batch);
      });
    } else {
      await recompute(input.tx, batch);
    }
  }
  return new Set(input.days).size;
}

/** The local days of the rows updated in `(since, through]`, in `zone`. */
export async function dirtyDays(
  db: Db,
  environmentId: string,
  zone: string,
  since: Date,
  through: Date,
): Promise<string[]> {
  const window = (column: string) =>
    sql`${sql.raw(column)} > ${since.toISOString()}::timestamptz
      and ${sql.raw(column)} <= ${through.toISOString()}::timestamptz`;
  const day = (column: string) => sql`((${sql.raw(column)}) at time zone ${zone})::date::text`;
  const result = await db.execute<{ day: string }>(
    sql`select ${day('i.created_at')} as day from inquiries i
        where i.environment_id = ${environmentId} and ${window('i.updated_at')}
      union
      select ${day('i.created_at')} from verifications v
        join inquiries i on i.environment_id = v.environment_id and i.id = v.inquiry_id
        where v.environment_id = ${environmentId} and ${window('v.updated_at')}
      union
      select ${day('i.created_at')} from verification_checks c
        join verifications v on v.environment_id = c.environment_id and v.id = c.verification_id
        join inquiries i on i.environment_id = v.environment_id and i.id = v.inquiry_id
        where c.environment_id = ${environmentId} and ${window('c.updated_at')}
      union
      select ${day('k.created_at')} from cases k
        where k.environment_id = ${environmentId} and ${window('k.updated_at')}`,
  );
  return (result as { rows: { day: string }[] }).rows.map((row) => row.day).sort();
}

/** The local day of the environment's first inquiry or case, `null` before any. */
export async function firstActivityDay(
  db: Db,
  environmentId: string,
  zone: string,
): Promise<string | null> {
  const result = await db.execute<{ day: string | null }>(
    sql`select ((least(
        (select min(created_at) from inquiries where environment_id = ${environmentId}),
        (select min(created_at) from cases where environment_id = ${environmentId})
      )) at time zone ${zone})::date::text as day`,
  );
  return (result as { rows: { day: string | null }[] }).rows[0]?.day ?? null;
}

/**
 * K9-24 (AA6): the first open day: the settle window's start, never before the retention window
 * nor on or before a day the rollup already closed.
 */
function openFrom(settleStart: string, kept: string, state: AnalyticsState | null): string {
  const open = laterDay(settleStart, kept);
  return state?.closedThrough == null ? open : laterDay(open, addDays(state.closedThrough, 1));
}

/** K9-24 (AA6): the last closed day after a pass whose first open day is `firstOpen`. */
function closedThrough(state: AnalyticsState | null, firstOpen: string): string {
  const closed = addDays(firstOpen, -1);
  return state?.closedThrough == null ? closed : laterDay(state.closedThrough, closed);
}

/** The first local day kept by `analytics-retention-months` before `today`. */
export const retentionStart = (today: string, months: number): string =>
  monthsBefore(today, months);

/**
 * One environment's refresh at `options.now`. Writes the state last, so a pass that fails part way
 * repeats its work on the next one.
 */
export async function refreshEnvironment(
  db: Db,
  environment: AnalyticsEnvironment,
  options: RefreshOptions,
): Promise<EnvironmentRefresh> {
  const zone = environment.settings['analytics-time-zone'];
  const settleDays = environment.settings['analytics-settle-days'];
  const watermark = new Date(options.now.getTime() - ANALYTICS_WATERMARK_LAG_MS);
  const state = await readAnalyticsState(db, environment.id);
  if (state?.timeZone != null && state.timeZone !== zone) {
    return { fullDays: 0, liveDays: 0, rebuildNeeded: true };
  }
  const today = localDayOf(watermark, zone);
  const kept = retentionStart(today, environment.settings['analytics-retention-months']);
  const firstOpen = openFrom(addDays(today, -settleDays), kept, state);
  const yesterday = addDays(today, -1);
  const common = { environmentId: environment.id, zone, logger: options.logger };

  let full: string[];
  let live: string[] = [];
  if (state?.rolledUpThrough == null) {
    // The first pass: every day back to the retention window, from the first with activity.
    const first = await firstActivityDay(db, environment.id, zone);
    full = first === null ? [] : daysFrom(laterDay(first, kept), yesterday);
  } else {
    const previousToday = localDayOf(state.rolledUpThrough, zone);
    const outcomesDay = state.outcomesAsOf === null ? null : localDayOf(state.outcomesAsOf, zone);
    // The days the previous pass still saw as current, now past.
    full = daysFrom(laterDay(previousToday, kept), yesterday);
    if (outcomesDay === null || outcomesDay < today) {
      // The first pass after the zone's midnight: every column of every open day (P21).
      full = [...new Set([...full, ...daysFrom(firstOpen, yesterday)])];
    }
    const stored = new Set(full);
    live = (await dirtyDays(db, environment.id, zone, state.rolledUpThrough, watermark)).filter(
      (day) => day >= firstOpen && day < previousToday && !stored.has(day),
    );
  }
  await recomputeDays(db, { ...common, days: full, columns: 'all' });
  await recomputeDays(db, { ...common, days: live, columns: 'live' });

  const outcomesRefreshed =
    state?.rolledUpThrough == null ||
    state.outcomesAsOf === null ||
    localDayOf(state.outcomesAsOf, zone) < today;
  await db.transaction(async (tx) => {
    await lockAnalyticsInTx(tx, environment.id);
    await writeAnalyticsState(tx, environment.id, {
      rolledUpThrough: watermark,
      outcomesAsOf: outcomesRefreshed ? watermark : state.outcomesAsOf,
      timeZone: zone,
      stepDataFrom: state?.stepDataFrom ?? (await firstStepDay(tx, environment.id, zone)),
      closedThrough: closedThrough(state, firstOpen),
    } satisfies AnalyticsState);
  });
  return { fullDays: full.length, liveDays: live.length, rebuildNeeded: false };
}

/**
 * C163.2: the open days of one environment recomputed in its current zone, in one transaction: the
 * `facts` rows of the open days (whatever zone they were in) are deleted and inserted again; closed
 * days and `redacted` rows are never touched, so they keep their zone. Reads the zone and the settle
 * window when it runs, so a repeated rebuild is harmless. Before the first pass there is nothing to
 * rebuild (the pass builds it).
 */
export async function rebuildEnvironment(
  db: Db,
  environment: AnalyticsEnvironment,
  options: RefreshOptions,
): Promise<number> {
  const zone = environment.settings['analytics-time-zone'];
  const state = await readAnalyticsState(db, environment.id);
  if (state?.rolledUpThrough == null) {
    return 0;
  }
  const watermark = new Date(options.now.getTime() - ANALYTICS_WATERMARK_LAG_MS);
  const today = localDayOf(watermark, zone);
  const kept = retentionStart(today, environment.settings['analytics-retention-months']);
  const firstOpen = openFrom(
    addDays(today, -environment.settings['analytics-settle-days']),
    kept,
    state,
  );
  const days = daysFrom(firstOpen, addDays(today, -1));
  return db.transaction(async (tx) => {
    await lockAnalyticsInTx(tx, environment.id);
    const rebuilt = await recomputeDays(db, {
      environmentId: environment.id,
      zone,
      days,
      columns: 'all',
      logger: options.logger,
      tx,
    });
    await writeAnalyticsState(tx, environment.id, {
      rolledUpThrough: watermark,
      outcomesAsOf: watermark,
      timeZone: zone,
      stepDataFrom: state.stepDataFrom ?? (await firstStepDay(tx, environment.id, zone)),
      closedThrough: closedThrough(state, firstOpen),
    });
    return rebuilt;
  });
}
