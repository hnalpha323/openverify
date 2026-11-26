/**
 * C76.4 (V01): the watchlist source rows, reconciled from the committed manifest
 * (`watchlists/sources.json`). One row per manifest source, with `sandbox_only` from the manifest
 * and `enabled` = `enabled_by_default` and not listed in `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`; a
 * source the manifest no longer lists keeps its row, disabled, for history. Nothing else writes
 * `enabled`. C254.1 (Workflow 11B): an opt-in source (the UN list) a caller names in
 * `optInSources` counts as enabled by default; each caller spreads `watchlistReconcileOptIn`, which
 * names none while the install switch is false, so `un-sc` then stays disabled as Phase 6 left it. The API (when it is ready,
 * `container.ts`), the worker (`worker.ts`, before its jobs start) and each CLI (`watchlists:sync`,
 * `watchlists:rekey`, `pep:sync`, `seed:dev`) call it first, so the rows exist before any template
 * resolves its source lists.
 *
 * Owner: `api-watchlists` (Workflow 6A Stage 3); the signature is frozen by `foundation-6`
 * (Stage 1b). It writes counts only to its caller, never a list value.
 */
import { WATCHLIST_OPT_IN_SOURCES } from '@openverify/contracts';
import { reconcileWatchlistSourceRows, type Db } from '@openverify/db';
import type { Clock } from '../ports.js';
import { watchlistManifest, type WatchlistManifest } from './manifest.js';

export interface ReconcileWatchlistSourcesOptions {
  /** `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`, parsed (`ApiConfig.watchlists.sourcesDisabled`). */
  disabled: readonly string[];
  clock?: Clock | undefined;
  /** The manifest to reconcile from; the committed one by default (tests pass their own). */
  manifest?: WatchlistManifest | undefined;
  /**
   * C254.1 (Workflow 11B): the opt-in sources some environment accepted while the install allows it
   * (`optedInWatchlistSources`, empty while `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` is false);
   * absent or empty, Phase 6's rule. Only a source of `WATCHLIST_OPT_IN_SOURCES` is read, and the
   * disabled list still wins.
   */
  optInSources?: readonly string[] | undefined;
}

/** What the reconciliation wrote; counts only. */
export interface ReconcileWatchlistSourcesResult {
  /** The manifest's sources, each with its row. */
  sources: number;
  enabled: number;
  /** Rows of sources the manifest no longer lists, kept disabled. */
  retired: number;
}

export type ReconcileWatchlistSources = (
  db: Db,
  options: ReconcileWatchlistSourcesOptions,
) => Promise<ReconcileWatchlistSourcesResult>;

const OPT_IN_SOURCES: ReadonlySet<string> = new Set(WATCHLIST_OPT_IN_SOURCES);

/** C76.4: the rows of the manifest's sources; see the file header. */
export const reconcileWatchlistSources: ReconcileWatchlistSources = (db, options) => {
  const disabled = new Set(options.disabled);
  const manifest = options.manifest ?? watchlistManifest();
  // C254.1 (Workflow 11B): an opt-in source an environment accepted while the install allows it.
  const optedIn = new Set((options.optInSources ?? []).filter((id) => OPT_IN_SOURCES.has(id)));
  return reconcileWatchlistSourceRows(
    db,
    manifest.sources.map((source) => ({
      id: source.id,
      enabled: (source.enabled_by_default || optedIn.has(source.id)) && !disabled.has(source.id),
      sandboxOnly: source.sandbox_only,
    })),
  );
};
