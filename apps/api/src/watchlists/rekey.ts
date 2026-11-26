/**
 * C78.3 (V04): the re-key of one source: every derived column (the names' normalised forms and
 * keys, the identifiers' and crypto addresses' normalised forms) and the key frequencies
 * recomputed from the stored records (`watchlist_entries.data`) with this process's
 * `keysVersion()`, in batches, under the source's advisory lock; then the source's `keys_version`
 * and a `rekeyed` row in `watchlist_syncs`. Refused without the filtered variant groups
 * (`refused_matcher_data`). The sync and the refresh tick call it first when the version differs;
 * `watchlists:rekey` calls it on its own. Owner: `api-watchlists`.
 */
import {
  insertWatchlistSync,
  listWatchlistEntryData,
  lockWatchlistSourceTransaction,
  rebuildWatchlistKeyDf,
  recordWatchlistSourceError,
  replaceWatchlistEntryParts,
  setWatchlistSourceKeysVersion,
  tryLockWatchlistSourceSession,
  unlockWatchlistSourceSession,
  watchlistWriteTuning,
  type Db,
} from '@openverify/db';
import { watchlistRecordSchema, type VariantGroups } from '@openverify/watchlist';
import type { Clock } from '../ports.js';
import type { WorkerLogger } from '../jobs/logger.js';
import type { MatcherData } from './matcher-data.js';
import { manifestSource, type WatchlistManifest } from './manifest.js';
import { entryPartsOf } from './records.js';
import type { WatchlistSession } from './sync-session.js';

/**
 * Records re-keyed per transaction: a performance constant (C270.2, Workflow 11D). The write
 * tunings' `rekeyBatch` overrides it for a measurement (`benchmark:performance --step <scale>-rekey
 * --tune rekey-batch=<n>`). Basis (docs/calibration/watchlist-phase11.md, method item 8; fix-11d):
 * the fastest median at 100,000 names within 2 GiB of heap (10,000: 50.5 s against 57.2 s at 500,
 * peak heap 1,154 MiB), confirmed once at 2,000,000 names against 500 (2,149.7 s against 2,270.5 s,
 * peak heap 1,446 against 1,225 MiB), every derived column identical.
 */
export const REKEY_BATCH = 10_000;

export interface RekeyLockedInput {
  sourceId: string;
  groups: VariantGroups;
  keysVersion: string;
  actor: 'cli' | 'job' | 'seed';
  clock: Clock;
}

/**
 * Re-keys a source whose session-level lock the caller holds.
 * @returns the `rekeyed` row's id and how many records were re-keyed.
 */
export async function rekeyLockedSource(
  db: Db,
  input: RekeyLockedInput,
): Promise<{ syncId: number; entries: number }> {
  const startedAt = input.clock.now();
  const batch = watchlistWriteTuning().rekeyBatch ?? REKEY_BATCH;
  let after: string | undefined;
  let entries = 0;
  for (;;) {
    const page = await listWatchlistEntryData(db, {
      sourceId: input.sourceId,
      afterEntryId: after,
      limit: batch,
    });
    if (page.length === 0) {
      break;
    }
    const parts = page.map(({ data }) =>
      entryPartsOf(watchlistRecordSchema.parse(data), input.groups),
    );
    await db.transaction((tx) =>
      replaceWatchlistEntryParts(tx, { sourceId: input.sourceId, entries: parts }),
    );
    entries += page.length;
    after = page.at(-1)?.entryId;
    if (page.length < batch) {
      break;
    }
  }
  return db.transaction(async (tx) => {
    await lockWatchlistSourceTransaction(tx, input.sourceId);
    await rebuildWatchlistKeyDf(tx, input.sourceId);
    await setWatchlistSourceKeysVersion(tx, {
      sourceId: input.sourceId,
      keysVersion: input.keysVersion,
    });
    const syncId = await insertWatchlistSync(tx, {
      sourceId: input.sourceId,
      startedAt,
      finishedAt: input.clock.now(),
      outcome: 'rekeyed',
      entryCount: entries,
      actor: input.actor,
      keysVersion: input.keysVersion,
    });
    return { syncId, entries };
  });
}

export interface WatchlistRekeyDeps {
  db: Db;
  connect(): Promise<WatchlistSession>;
  clock: Clock;
  logger: WorkerLogger;
  matcherData(): MatcherData;
  manifest?: WatchlistManifest | undefined;
}

export interface WatchlistRekeyResult {
  sourceId: string;
  outcome: 'rekeyed' | 'busy' | 'refused_matcher_data';
  syncId: number;
  entries: number;
}

/**
 * `watchlists:rekey` for one source: refused without the matcher data, `busy` when another sync
 * holds the source.
 * @throws {Error} for a source the manifest does not know.
 */
export async function rekeyWatchlistSource(
  deps: WatchlistRekeyDeps,
  request: { sourceId: string; actor: 'cli' | 'job' | 'seed' },
): Promise<WatchlistRekeyResult> {
  if (manifestSource(request.sourceId, deps.manifest) === undefined) {
    throw new Error('unknown watchlist source');
  }
  const startedAt = deps.clock.now();
  const refused = async (outcome: 'busy' | 'refused_matcher_data') => {
    if (outcome === 'refused_matcher_data') {
      await recordWatchlistSourceError(deps.db, {
        sourceId: request.sourceId,
        code: 'refused_matcher_data',
      });
    }
    const syncId = await insertWatchlistSync(deps.db, {
      sourceId: request.sourceId,
      startedAt,
      finishedAt: deps.clock.now(),
      outcome,
      actor: request.actor,
    });
    deps.logger.warn({ sourceId: request.sourceId, outcome, syncId }, 'watchlist re-key refused');
    return { sourceId: request.sourceId, outcome, syncId, entries: 0 };
  };
  const matcher = deps.matcherData();
  if (matcher.status !== 'loaded') {
    return refused('refused_matcher_data');
  }
  const session = await deps.connect();
  try {
    if (!(await tryLockWatchlistSourceSession(session.db, request.sourceId))) {
      return await refused('busy');
    }
    try {
      const { syncId, entries } = await rekeyLockedSource(session.db, {
        sourceId: request.sourceId,
        groups: matcher.groups,
        keysVersion: matcher.keysVersion,
        actor: request.actor,
        clock: deps.clock,
      });
      deps.logger.info(
        { sourceId: request.sourceId, syncId, entries },
        'watchlist source re-keyed',
      );
      return { sourceId: request.sourceId, outcome: 'rekeyed', syncId, entries };
    } finally {
      await unlockWatchlistSourceSession(session.db, request.sourceId);
    }
  } finally {
    await session.release();
  }
}
