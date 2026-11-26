/**
 * C163.4 (Workflow 9B; decisions 36 and 72, reviews H04, P21): one `analytics-rollup` pass, every
 * 5 minutes. Owner: `api-analytics`; the signature and the worker's registration
 * (`analyticsRepeatableJobs` in `jobs/repeatable/index.ts`) were placed by `foundation-9b`
 * (Stage 1b (A)).
 *
 * Per environment (`refreshEnvironment`, `services/analytics/refresh.ts`): the days the watermark
 * (`now() - 2 minutes`) has passed are stored; the open days with a row updated since the last
 * watermark get their live counts; the first pass after the zone's midnight recomputes every column
 * of every open day; closed days are frozen. An environment whose zone changed is handed to
 * `analytics-rebuild` through `rebuilds` (or rebuilt in this pass when no producer is given). One
 * environment's failure is logged with its id only and retried on the next pass; it never stops the
 * others.
 */
import type { Db } from '@openverify/db';
import type { AnalyticsRebuildQueue, Clock } from '../../ports.js';
import { rebuildEnvironment, refreshEnvironment } from '../../services/analytics/refresh.js';
import { analyticsEnvironments } from '../../services/analytics/state.js';
import type { WorkerLogger } from '../logger.js';

/** What one pass reads. */
export interface AnalyticsRollupDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** The `analytics-rebuild` producer, for an environment whose reporting zone changed. */
  rebuilds?: AnalyticsRebuildQueue | undefined;
}

/** What one pass did: counts only, never a value. */
export interface AnalyticsRollupResult {
  /** Environments with at least one day recomputed. */
  environments: number;
  /** Days recomputed (every column or the live counts). */
  days: number;
  /** Rebuilds queued for a changed zone. */
  rebuildsQueued: number;
  /** Environments a pass could not refresh; each is logged with its id and tried on the next pass. */
  failed: number;
}

export type RunAnalyticsRollup = (deps: AnalyticsRollupDeps) => Promise<AnalyticsRollupResult>;

export const runAnalyticsRollup: RunAnalyticsRollup = async (deps) => {
  const result: AnalyticsRollupResult = { environments: 0, days: 0, rebuildsQueued: 0, failed: 0 };
  const now = deps.clock.now();
  for (const environment of await analyticsEnvironments(deps.db)) {
    try {
      const refreshed = await refreshEnvironment(deps.db, environment, {
        now,
        logger: deps.logger,
      });
      if (refreshed.rebuildNeeded) {
        if (deps.rebuilds === undefined) {
          result.days += await rebuildEnvironment(deps.db, environment, {
            now,
            logger: deps.logger,
          });
          result.environments += 1;
        } else {
          await deps.rebuilds.enqueueAnalyticsRebuild({ environmentId: environment.id });
          result.rebuildsQueued += 1;
        }
        continue;
      }
      const days = refreshed.fullDays + refreshed.liveDays;
      if (days > 0) {
        result.environments += 1;
        result.days += days;
      }
    } catch (error: unknown) {
      result.failed += 1;
      deps.logger.error(
        {
          queue: 'analytics-rollup',
          environmentId: environment.id,
          error: error instanceof Error ? error.name : 'unknown',
        },
        'analytics rollup failed for an environment',
      );
    }
  }
  return result;
};
