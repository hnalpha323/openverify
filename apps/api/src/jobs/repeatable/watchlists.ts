/**
 * C76.2 (F17; Workflow 6A Stage 3, owner `api-watchlists`): the `watchlists-refresh` tick, which
 * the repeatable-job registry (`jobs/repeatable/index.ts`) schedules every 15 minutes in the
 * worker, only with `OPENVERIFY_WATCHLIST_REFRESH=true`. Each tick reconciles the source rows
 * (C76.4) and runs the same code as `watchlists:sync` for each enabled source whose
 * `refresh_interval_hours` has passed since its last check, and whose back-off after failed checks
 * has passed since the last failure (owner decision 6): re-key first when its `keys_version`
 * differs; a source that is not configured is skipped without a sync row (`source_not_configured`);
 * after an applied sync left `pending`, it enqueues `report-rescreen` (C74.4). Never in CI.
 *
 * The signature and the deps are frozen by `foundation-6` (Stage 1b). A source that is not due is
 * still re-keyed when its keys come from another matcher version, so an upgrade with the refresh on
 * stops erroring `matcher_data_unavailable` at the next tick (V04). Sources are synced one at a
 * time; one that throws is logged by its id and counted, and the tick goes on. Logs carry ids,
 * outcomes and counts only.
 */
import { getWatchlistSourceStates, type Db } from '@openverify/db';
import type { WatchlistSettings } from '../../config.js';
import type { OutboundHttp } from '../../http/index.js';
import type { Clock, ReportRescreenQueue } from '../../ports.js';
import { loadMatcherData, type MatcherData } from '../../watchlists/matcher-data.js';
import { watchlistManifest, type WatchlistManifest } from '../../watchlists/manifest.js';
import { reconcileWatchlistSources } from '../../watchlists/reconcile.js';
import { watchlistReconcileOptIn } from '../../watchlists/un-opt-in.js';
import { rekeyWatchlistSource } from '../../watchlists/rekey.js';
import { watchlistSessionsOf, type WatchlistSession } from '../../watchlists/sync-session.js';
import { syncWatchlistSource } from '../../watchlists/sync.js';
import type { WorkerLogger } from '../logger.js';

export interface WatchlistsRefreshDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** The list clients' factory (`OutboundHttp.streamClient`, C85.1). */
  outboundHttp?: OutboundHttp | undefined;
  watchlists: WatchlistSettings;
  /** Enqueues the re-screen of each sync left `pending`, after its commit. */
  rescreens: ReportRescreenQueue;
  /** Opens a sync's dedicated connection; a pool connection of `db` by default (tests: shared). */
  connect?: (() => Promise<WatchlistSession>) | undefined;
  /** The filtered variant groups (C78.3); `loadMatcherData()` by default. */
  matcherData?: (() => MatcherData) | undefined;
  /** The committed `watchlists/sources.json` by default. */
  manifest?: WatchlistManifest | undefined;
}

/** What one tick did; counts and outcomes only, never names. */
export interface WatchlistsRefreshResult {
  /** Sources whose refresh interval had passed. */
  due: number;
  applied: number;
  unchanged: number;
  /** Not configured (no EU token, no Wikidata User-Agent), or held by another sync. */
  skipped: number;
  /** Refused or failed. */
  failed: number;
  /** Sources not due whose keys were from another matcher version, re-keyed (C78.3, V04). */
  rekeyed: number;
}

export type RunWatchlistsRefresh = (
  deps: WatchlistsRefreshDeps,
) => Promise<WatchlistsRefreshResult>;

const HOUR_MS = 3_600_000;

/** Owner decision 6 (K6A-11): the wait after a source's first failed check. */
const FIRST_BACKOFF_MS = 15 * 60_000;
/** ... and the longest wait, whatever the source's refresh interval. */
const MAX_BACKOFF_MS = 24 * HOUR_MS;

/**
 * Owner decision 6 (K6A-11): how long a source whose last `failures` checks failed waits before
 * the next one: 15 minutes after the first failure, doubling with each, capped at its refresh
 * interval and at 24 hours (exponential back-off, polite to the publishers and to Wikidata). No
 * wait without a failure.
 */
export function refreshBackoffMs(failures: number, refreshIntervalMs: number): number {
  if (failures < 1) {
    return 0;
  }
  const doubled = FIRST_BACKOFF_MS * 2 ** Math.min(failures - 1, 32);
  return Math.min(doubled, refreshIntervalMs, MAX_BACKOFF_MS);
}

/** C76.2: one `watchlists-refresh` tick; see the file header. */
export const runWatchlistsRefresh: RunWatchlistsRefresh = async (deps) => {
  const manifest = deps.manifest ?? watchlistManifest();
  const now = deps.clock.now();
  await reconcileWatchlistSources(deps.db, {
    disabled: deps.watchlists.sourcesDisabled,
    manifest,
    // C254.1 (Q10 granted; KP11-31): an environment's recorded UN opt-in, while allowed.
    ...(await watchlistReconcileOptIn(deps.db, deps.watchlists.unOptInAllowed === true)),
  });
  const refreshed = manifest.sources.filter(
    (source) => source.urls.length > 0 && source.refresh_interval_hours !== null,
  );
  const states = new Map(
    (
      await getWatchlistSourceStates(
        deps.db,
        refreshed.map((source) => source.id),
      )
    ).map((state) => [state.id, state]),
  );
  const connect = deps.connect ?? watchlistSessionsOf(deps.db);
  const matcherData = deps.matcherData ?? (() => loadMatcherData());
  const result: WatchlistsRefreshResult = {
    due: 0,
    applied: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    rekeyed: 0,
  };
  for (const source of refreshed) {
    const state = states.get(source.id);
    if (state?.enabled !== true) {
      continue;
    }
    const interval = (source.refresh_interval_hours ?? 0) * HOUR_MS;
    // K6A-11: a source whose last checks failed waits out its back-off from the last failure.
    const failures = state.checkFailures ?? 0;
    const backedOff =
      failures > 0 &&
      state.lastFailedAt != null &&
      now.getTime() - state.lastFailedAt.getTime() < refreshBackoffMs(failures, interval);
    const due =
      !backedOff &&
      (state.lastCheckedAt === null || now.getTime() - state.lastCheckedAt.getTime() >= interval);
    try {
      if (!due) {
        const matcher = matcherData();
        if (
          matcher.status === 'loaded' &&
          state.keysVersion !== null &&
          state.keysVersion !== matcher.keysVersion
        ) {
          const rekeyed = await rekeyWatchlistSource(
            {
              db: deps.db,
              connect,
              clock: deps.clock,
              logger: deps.logger,
              matcherData: () => matcher,
              manifest,
            },
            { sourceId: source.id, actor: 'job' },
          );
          result.rekeyed += rekeyed.outcome === 'rekeyed' ? 1 : 0;
        }
        continue;
      }
      result.due += 1;
      const synced = await syncWatchlistSource(
        {
          db: deps.db,
          connect,
          clock: deps.clock,
          logger: deps.logger,
          settings: deps.watchlists,
          outboundHttp: deps.outboundHttp,
          rescreens: deps.rescreens,
          matcherData,
          manifest,
        },
        { sourceId: source.id, actor: 'job' },
      );
      if (synced.outcome === 'applied') {
        result.applied += 1;
      } else if (synced.outcome === 'unchanged') {
        result.unchanged += 1;
      } else if (
        synced.outcome === 'busy' ||
        (synced.outcome === 'error' && synced.errorCode === 'source_not_configured')
      ) {
        result.skipped += 1;
      } else {
        result.failed += 1;
      }
    } catch (error) {
      result.failed += due ? 1 : 0;
      deps.logger.error(
        { sourceId: source.id, error: (error as Error).name },
        'watchlist refresh of a source failed',
      );
    }
  }
  deps.logger.info({ ...result }, 'watchlist refresh finished');
  return result;
};
