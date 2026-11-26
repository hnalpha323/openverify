/**
 * C163.6, C16 (Workflow 9B; decision 38, review P20): the analytics steps of the C16 retention pass,
 * which `runRetention` (`services/retention.ts`) calls and whose counts join its report. Owner:
 * `api-analytics`; `foundation-9b` (Stage 1b (A)) froze the signature and placed the call.
 *
 * Per environment, in batches of `limit` rows, it removes the rollup rows whose local `day` is before
 * `analytics-retention-months` back from today (in the environment's reporting zone), and the
 * `analytics_case_assignee_daily` rows before `analytics-assignee-retention-months` (employee data
 * with its own window, P20). Counts only; both sources alike.
 */
import { analyticsRollupTableOf, type Db } from '@openverify/db';
import { getTableName, sql } from 'drizzle-orm';
import { localDayOf, monthsBefore } from './days.js';
import { analyticsEnvironments } from './state.js';
import { ROLLUPS } from './store.js';

/** What the analytics steps of one retention run removed: counts only. */
export interface AnalyticsRetentionReport {
  /** Rollup rows (every table but the assignee rollup) past `analytics-retention-months`. */
  deletedAnalyticsRollupRows: number;
  /** Assignee rollup rows past `analytics-assignee-retention-months` (review P20). */
  deletedAnalyticsAssigneeRows: number;
}

export interface AnalyticsRetentionDeps {
  db: Db;
}

/** One batch's bounds: the run's "now" and the batch size (`DeleteOptions`). */
export interface AnalyticsRetentionBatch {
  now: Date;
  limit: number;
}

export type RunAnalyticsRetention = (
  deps: AnalyticsRetentionDeps,
  batch: AnalyticsRetentionBatch,
) => Promise<AnalyticsRetentionReport>;

/** Removes, `limit` at a time, the rows of one table and environment before `before`. */
async function removeBefore(
  db: Db,
  table: string,
  environmentId: string,
  before: string,
  limit: number,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const result = await db.execute<{ day: string }>(
      sql`with gone as (
          delete from ${sql.identifier(table)} where ctid in (
            select ctid from ${sql.identifier(table)}
            where environment_id = ${environmentId} and day < ${before}::date limit ${limit})
          returning day)
        select count(*)::int as count from gone`,
    );
    const [row] = (result as { rows: { count: number }[] }).rows;
    const count = row?.count ?? 0;
    removed += count;
    if (count < limit) {
      return removed;
    }
  }
}

export const runAnalyticsRetention: RunAnalyticsRetention = async ({ db }, { now, limit }) => {
  const report: AnalyticsRetentionReport = {
    deletedAnalyticsRollupRows: 0,
    deletedAnalyticsAssigneeRows: 0,
  };
  for (const environment of await analyticsEnvironments(db)) {
    const today = localDayOf(now, environment.settings['analytics-time-zone']);
    const rollupsFrom = monthsBefore(today, environment.settings['analytics-retention-months']);
    const assigneesFrom = monthsBefore(
      today,
      environment.settings['analytics-assignee-retention-months'],
    );
    for (const rollup of ROLLUPS) {
      const table = getTableName(analyticsRollupTableOf(rollup.name));
      if (rollup.rows === 'assignee') {
        report.deletedAnalyticsAssigneeRows += await removeBefore(
          db,
          table,
          environment.id,
          assigneesFrom,
          limit,
        );
      } else {
        report.deletedAnalyticsRollupRows += await removeBefore(
          db,
          table,
          environment.id,
          rollupsFrom,
          limit,
        );
      }
    }
  }
  return report;
};
