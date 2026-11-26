/**
 * C92.5 (Workflow 7A, F41): the network source rows, reconciled from `network/sources.json` at API
 * and worker startup and first in each CLI, as C76.4 does for the watchlist sources: one row per
 * manifest source, `enabled` from the manifest less `OPENVERIFY_NETWORK_SOURCES_DISABLED` plus
 * `OPENVERIFY_NETWORK_SOURCES_ENABLED`.
 *
 * `OPENVERIFY_NETWORK_SOURCES_DISABLED` wins over `OPENVERIFY_NETWORK_SOURCES_ENABLED`; an id the
 * manifest does not name is ignored (the configuration checks the ids' form only). A source the
 * manifest no longer names keeps its row, disabled, for history. Nothing else writes `enabled`.
 *
 * Owner: `api-network` (Stage 3), with the manifest and its schema test. Counts only, never a value.
 */
import { reconcileNetworkSourceRows, type Db } from '@openverify/db';
import type { NetworkSettings } from '../config.js';
import type { Clock } from '../ports.js';
import { networkManifest, type NetworkManifest } from './manifest.js';

export interface NetworkReconcileOptions extends Pick<
  NetworkSettings,
  'sourcesDisabled' | 'sourcesEnabled'
> {
  clock: Clock;
  /** The manifest to reconcile from; the committed one by default (tests pass their own). */
  manifest?: NetworkManifest | undefined;
}

/** How many source rows reconciliation wrote, and how many it turned off. */
export interface NetworkReconcileResult {
  upserted: number;
  disabled: number;
}

/** C92.5: reconciles the source rows with the manifest; see the file header. */
export function reconcileNetworkSources(
  db: Db,
  options: NetworkReconcileOptions,
): Promise<NetworkReconcileResult> {
  const disabled = new Set(options.sourcesDisabled);
  const enabled = new Set(options.sourcesEnabled);
  const manifest = options.manifest ?? networkManifest();
  return reconcileNetworkSourceRows(
    db,
    manifest.sources.map((source) => ({
      id: source.id,
      enabled: (source.enabled_by_default || enabled.has(source.id)) && !disabled.has(source.id),
      sandboxOnly: source.sandbox_only,
    })),
  );
}
