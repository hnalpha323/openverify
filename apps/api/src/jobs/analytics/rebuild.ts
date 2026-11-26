/**
 * C163.2 (Workflow 9B; decision 36, review H04): one `analytics-rebuild` job: an environment's open
 * days recomputed in its current reporting zone, after a zone change. Owner: `api-analytics`; the
 * signature, the queue (`jobs/analytics-queues.ts`) and the worker's registration were placed by
 * `foundation-9b` (Stage 1b (A)).
 *
 * It reads the environment's zone and settle window when it runs (so a repeated job is harmless),
 * deletes and inserts each open day's `source = 'facts'` rows in that zone in one transaction, never
 * touches a closed day or a `redacted` row (which keeps the zone it was computed in, C163.2), and
 * records the zone in `analytics_rollup_state` (`rebuildEnvironment`). An environment that no longer
 * exists rebuilds nothing.
 */
import type { Db } from '@openverify/db';
import type { AnalyticsRebuildJob, Clock } from '../../ports.js';
import { rebuildEnvironment } from '../../services/analytics/refresh.js';
import { analyticsEnvironmentOf } from '../../services/analytics/state.js';
import type { WorkerLogger } from '../logger.js';

/** What the job reads. */
export interface AnalyticsRebuildDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
}

/** What one job did: counts only. */
export interface AnalyticsRebuildResult {
  /** Open days recomputed in the environment's current zone. */
  days: number;
}

export type ProcessAnalyticsRebuild = (
  job: AnalyticsRebuildJob,
  deps: AnalyticsRebuildDeps,
) => Promise<AnalyticsRebuildResult>;

export const processAnalyticsRebuild: ProcessAnalyticsRebuild = async (job, deps) => {
  const environment = await analyticsEnvironmentOf(deps.db, job.environmentId);
  if (environment === null) {
    return { days: 0 };
  }
  const days = await rebuildEnvironment(deps.db, environment, {
    now: deps.clock.now(),
    logger: deps.logger,
  });
  deps.logger.info(
    { queue: 'analytics-rebuild', environmentId: environment.id, days },
    'analytics open days rebuilt in the reporting zone',
  );
  return { days };
};
