/**
 * C92.2 (Workflow 7A Stage 3, owner `api-network`): the `network-refresh` tick, which the
 * repeatable-job registry (`jobs/repeatable/index.ts`) schedules every 15 minutes in the worker,
 * only with `OPENVERIFY_NETWORK_REFRESH=true`. Each tick runs the same code as `network:sync` for
 * each enabled source whose refresh interval has passed since its last check (and whose back-off
 * after failed checks has passed), one source at a time. Never in CI. Logs carry source ids,
 * outcomes and counts only.
 *
 * The back-off is the watchlists' (owner decision 6 after Workflow 6A, `refreshBackoffMs`): 15
 * minutes after the first failed check, doubling, capped at the source's refresh interval and at
 * 24 hours; a refusal counts as a failed check, as for the watchlists. The tick reconciles the
 * source rows first; import-only sources (Azure, the sandbox) are never refreshed. A source that
 * throws is logged by its id and counted as failed, and the tick goes on.
 *
 * The signature and the deps are frozen by `foundation-7a` (Stage 1b (N)); `connect` and
 * `manifest` are `api-network`'s optional additions for tests.
 */
import { listNetworkSourceStates, type Db } from '@openverify/db';
import type { NetworkSettings } from '../../config.js';
import type { OutboundHttp } from '../../http/index.js';
import type { Clock, FileStorage } from '../../ports.js';
import { networkManifest, type NetworkManifest } from '../../network/manifest.js';
import { reconcileNetworkSources } from '../../network/reconcile.js';
import { syncNetworkSource } from '../../network/sync.js';
import type { SyncSession } from '../../sync/runner.js';
import { watchlistSessionsOf } from '../../watchlists/sync-session.js';
import { refreshBackoffMs } from './watchlists.js';
import type { WorkerLogger } from '../logger.js';

export interface NetworkRefreshDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** The network-source clients' factory (`OutboundHttp.streamClient`, C85.1 as C92.2 amends it). */
  outboundHttp?: OutboundHttp | undefined;
  /** Where an applied sync writes its snapshot, `network/<source>/<sha256>` (C92.3). */
  storage: FileStorage;
  network: NetworkSettings;
  /** Opens a sync's dedicated connection; a pool connection of `db` by default (tests: shared). */
  connect?: (() => Promise<SyncSession>) | undefined;
  /** The committed `network/sources.json` by default. */
  manifest?: NetworkManifest | undefined;
}

/** What one tick did, as counts. */
export interface NetworkRefreshResult {
  due: number;
  applied: number;
  unchanged: number;
  refused: number;
  failed: number;
}

const HOUR_MS = 3_600_000;

/** C92.2: one `network-refresh` tick; see the file header. */
export async function runNetworkRefresh(deps: NetworkRefreshDeps): Promise<NetworkRefreshResult> {
  const manifest = deps.manifest ?? networkManifest();
  const now = deps.clock.now();
  await reconcileNetworkSources(deps.db, {
    sourcesDisabled: deps.network.sourcesDisabled,
    sourcesEnabled: deps.network.sourcesEnabled,
    clock: deps.clock,
    manifest,
  });
  const states = new Map(
    (await listNetworkSourceStates(deps.db)).map((state) => [state.id, state]),
  );
  const connect = deps.connect ?? watchlistSessionsOf(deps.db);
  const result: NetworkRefreshResult = { due: 0, applied: 0, unchanged: 0, refused: 0, failed: 0 };
  for (const source of manifest.sources) {
    const state = states.get(source.id);
    const downloads = source.urls.length > 0 || source.url_template !== null;
    if (state?.enabled !== true || !downloads || source.refresh_interval_hours === null) {
      continue;
    }
    const interval = source.refresh_interval_hours * HOUR_MS;
    const backedOff =
      state.checkFailures > 0 &&
      state.lastFailedAt !== null &&
      now.getTime() - state.lastFailedAt.getTime() <
        refreshBackoffMs(state.checkFailures, interval);
    const due =
      !backedOff &&
      (state.lastCheckedAt === null || now.getTime() - state.lastCheckedAt.getTime() >= interval);
    if (!due) {
      continue;
    }
    result.due += 1;
    try {
      const synced = await syncNetworkSource(
        {
          db: deps.db,
          connect,
          clock: deps.clock,
          logger: deps.logger,
          storage: deps.storage,
          outboundHttp: deps.outboundHttp,
          manifest,
        },
        { sourceId: source.id, actor: 'job' },
      );
      if (synced.outcome === 'applied') {
        result.applied += 1;
      } else if (synced.outcome === 'unchanged') {
        result.unchanged += 1;
      } else if (synced.outcome.startsWith('refused_')) {
        result.refused += 1;
      } else if (synced.outcome === 'error') {
        result.failed += 1;
      }
    } catch (error) {
      result.failed += 1;
      deps.logger.error(
        { sourceId: source.id, error: (error as Error).name },
        'network refresh of a source failed',
      );
    }
  }
  deps.logger.info({ ...result }, 'network refresh finished');
  return result;
}
