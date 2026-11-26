/**
 * C74.3, C76.2, C85.4 (Phase 6): the report repeatable jobs. `report-sweep` runs every 15
 * seconds whenever the worker runs reports; `watchlists-refresh` every 15 minutes only with
 * `OPENVERIFY_WATCHLIST_REFRESH=true`, never in CI. Each runs its owner's function with the
 * worker's producers and settings (`jobs/reports/sweep.ts`, `jobs/repeatable/watchlists.ts`).
 */
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import type { WatchlistSettings } from '../../config.js';
import {
  createRecordingReportRescreenQueue,
  createRecordingReportRunQueue,
  createRefusingOutboundHttp,
} from '../../test-support/fakes.js';
import { REPORT_SWEEP_QUEUE, WATCHLISTS_REFRESH_QUEUE } from '../report-queues.js';
import { createCapturingLogger } from '../testing.js';
import {
  phase6RepeatableJobs,
  type ReportRepeatableDeps,
  type RepeatableJobDeps,
} from './index.js';

const owners = vi.hoisted(() => ({
  sweep: vi.fn(() => Promise.resolve({ enqueued: 1, scheduled: 2, rescreens: 0, failed: 0 })),
  refresh: vi.fn(() =>
    Promise.resolve({ due: 1, applied: 1, unchanged: 0, skipped: 0, failed: 0 }),
  ),
}));
vi.mock('../reports/sweep.js', () => ({ runReportSweep: owners.sweep }));
vi.mock('./watchlists.js', () => ({ runWatchlistsRefresh: owners.refresh }));

const WATCHLISTS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
  removedRetentionDays: 90,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
  pep: {
    openTenureMaxYears: 20,
    includeRelatives: false,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
};

function deps(): RepeatableJobDeps {
  return {
    db: {} as Db,
    clock: { now: () => new Date('2026-10-27T00:00:00Z') },
    logger: createCapturingLogger(),
    outboundHttp: createRefusingOutboundHttp(),
  };
}

function reports(refresh = false): ReportRepeatableDeps {
  return {
    runs: createRecordingReportRunQueue(),
    rescreens: createRecordingReportRescreenQueue(),
    limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
    watchlists: { ...WATCHLISTS, refresh },
  };
}

describe('phase6RepeatableJobs (C85.4)', () => {
  it('schedules nothing when the worker runs no reports', () => {
    expect(phase6RepeatableJobs(deps(), undefined)).toEqual([]);
  });

  it('sweeps every 15 seconds, and refreshes the lists only when told to', () => {
    const schedules = (refresh: boolean) =>
      phase6RepeatableJobs(deps(), reports(refresh)).map(({ name, repeat }) => ({ name, repeat }));

    expect(schedules(false)).toEqual([{ name: 'report-sweep', repeat: { every: 15_000 } }]);
    expect(schedules(true)).toEqual([
      { name: 'report-sweep', repeat: { every: 15_000 } },
      { name: 'watchlists-refresh', repeat: { every: 900_000 } },
    ]);
  });

  it('runs the sweep with the producers and the limits, and the tick with the settings', async () => {
    const base = deps();
    const settings = reports(true);
    const [sweep, refresh] = phase6RepeatableJobs(base, settings);

    expect([sweep?.name, refresh?.name]).toEqual([REPORT_SWEEP_QUEUE, WATCHLISTS_REFRESH_QUEUE]);
    await expect(sweep?.run()).resolves.toEqual({
      enqueued: 1,
      scheduled: 2,
      rescreens: 0,
      failed: 0,
    });
    await expect(refresh?.run()).resolves.toMatchObject({ applied: 1 });
    expect(owners.sweep).toHaveBeenCalledWith({
      db: base.db,
      clock: base.clock,
      logger: base.logger,
      runs: settings.runs,
      rescreens: settings.rescreens,
      limits: settings.limits,
    });
    expect(owners.refresh).toHaveBeenCalledWith({
      db: base.db,
      clock: base.clock,
      logger: base.logger,
      outboundHttp: base.outboundHttp,
      watchlists: settings.watchlists,
      rescreens: settings.rescreens,
    });
  });
});
