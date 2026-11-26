/**
 * C270.1 (Workflow 11D, matcher-write-11d): the full rebuild of one source's key frequencies
 * (`rebuildWatchlistKeyDf`), under the source's advisory locks, for `watchlists:rebuild-key-df`. The
 * sync keeps the frequencies by its delta behind the switch `incremental-key-df`; this command
 * rebuilds them in full whatever the switch says, the repair for a table that was not exact.
 *
 * It takes the source's session-level try-lock on its own connection (`busy` while a sync or a
 * re-key holds it), then rebuilds in one transaction under the per-source transaction lock, as the
 * re-key does. As the runtime role it ANALYZEs `watchlist_entries` and `watchlist_names` and calls
 * `openverify_gin_clean_pending_lists` (C249.3). Logs carry the source id and counts only.
 */
import {
  countWatchlistKeyDfRows,
  lockWatchlistSourceTransaction,
  rebuildWatchlistKeyDf,
  tryLockWatchlistSourceSession,
  unlockWatchlistSourceSession,
  type Db,
} from '@openverify/db';
import type { WorkerLogger } from '../jobs/logger.js';
import { manifestSource, type WatchlistManifest } from './manifest.js';
import type { WatchlistSession } from './sync-session.js';

export interface WatchlistKeyDfRebuildDeps {
  db: Db;
  connect(): Promise<WatchlistSession>;
  logger: WorkerLogger;
  manifest?: WatchlistManifest | undefined;
}

export interface WatchlistKeyDfRebuildResult {
  sourceId: string;
  outcome: 'rebuilt' | 'busy';
  /** The frequency rows the source holds after the rebuild (0 when busy). */
  keys: number;
}

/**
 * Rebuilds one source's key frequencies in full.
 * @throws {Error} for a source the manifest does not know.
 */
export async function rebuildWatchlistSourceKeyDf(
  deps: WatchlistKeyDfRebuildDeps,
  request: { sourceId: string },
): Promise<WatchlistKeyDfRebuildResult> {
  const { sourceId } = request;
  if (manifestSource(sourceId, deps.manifest) === undefined) {
    throw new Error('unknown watchlist source');
  }
  const session = await deps.connect();
  try {
    if (!(await tryLockWatchlistSourceSession(session.db, sourceId))) {
      deps.logger.warn({ sourceId, outcome: 'busy' }, 'watchlist key frequencies not rebuilt');
      return { sourceId, outcome: 'busy', keys: 0 };
    }
    try {
      const keys = await session.db.transaction(async (tx) => {
        await lockWatchlistSourceTransaction(tx, sourceId);
        await rebuildWatchlistKeyDf(tx, sourceId);
        return countWatchlistKeyDfRows(tx, sourceId);
      });
      deps.logger.info({ sourceId, keys }, 'watchlist key frequencies rebuilt');
      return { sourceId, outcome: 'rebuilt', keys };
    } finally {
      await unlockWatchlistSourceSession(session.db, sourceId);
    }
  } finally {
    await session.release();
  }
}
