/**
 * Test support for the report engine's tests (Workflow 6A Stage 3, `api-reports`): a synthetic
 * source manifest with the plan's source ids, installed as the catalog in force. Synthetic values
 * only; no publisher is named beyond the source ids.
 */
import {
  catalogOf,
  parseWatchlistManifest,
  useWatchlistSourceCatalog,
  type WatchlistSourceCatalog,
} from './source-catalog.js';

const source = (id: string, kind: 'sanctions' | 'pep', extra: Record<string, unknown> = {}) => ({
  id,
  kind,
  publisher: `Synthetic ${id}`,
  urls: [`https://lists.example/${id}`],
  refresh_interval_hours: kind === 'pep' ? 168 : 6,
  stale_after_hours: kind === 'pep' ? 192 : 48,
  sandbox_only: false,
  attribution: `Synthetic attribution of ${id}`,
  ...extra,
});

const SANDBOX = { sandbox_only: true, refresh_interval_hours: null, stale_after_hours: null };

/** The synthetic manifest entries (C76.1's fields), with the plan's source ids. */
export const TEST_WATCHLIST_SOURCES = Object.freeze([
  source('ofac-sdn', 'sanctions'),
  source('eu-fsf', 'sanctions'),
  source('uk-sanctions-list', 'sanctions'),
  source('openverify-sandbox', 'sanctions', SANDBOX),
  source('wikidata-pep', 'pep'),
  source('openverify-sandbox-pep', 'pep', SANDBOX),
]);

/** The catalog of {@link TEST_WATCHLIST_SOURCES}. */
export const TEST_WATCHLIST_CATALOG: WatchlistSourceCatalog = catalogOf(
  parseWatchlistManifest(TEST_WATCHLIST_SOURCES),
);

/** Installs {@link TEST_WATCHLIST_CATALOG}; returns the restore function. */
export function useTestWatchlistCatalog(): () => void {
  return useWatchlistSourceCatalog(TEST_WATCHLIST_CATALOG);
}
