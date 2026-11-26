/**
 * C76.6 (decision 14, V03): the import of the two synthetic sandbox lists, `openverify-sandbox`
 * and `openverify-sandbox-pep`, from the committed fixtures of `@openverify/watchlist/testing`
 * (normalised JSON, fictional people and companies only), as `seed:dev` runs it after the source
 * reconciliation (C76.4). Each list goes through the sync (`actor: seed`, `origin: import`), so a
 * second seed finds it `unchanged`. Without the filtered variant-group file the imports are
 * skipped with a warning naming `python3 scripts/fetch_data.py`, and the sandbox reports answer
 * `list_unavailable` rather than the seed failing (C78.3, F14). A sandbox list the operator
 * disabled is not imported. `seed:dev` itself refuses production mode. Owner: `api-watchlists`.
 */
import { fileURLToPath } from 'node:url';
import { getWatchlistSourceStates, type Db } from '@openverify/db';
import { FIXTURES_DIRECTORY } from '@openverify/watchlist/testing';
import { PHASE6_DEFAULTS, type WatchlistSettings } from '../config.js';
import type { WorkerLogger } from '../jobs/logger.js';
import type { Clock } from '../ports.js';
import { loadMatcherData, type MatcherData } from './matcher-data.js';
import { watchlistManifest, type WatchlistManifest } from './manifest.js';
import { watchlistSessionsOf, type WatchlistSession } from './sync-session.js';
import { syncWatchlistSource, type WatchlistSyncOutcomeName } from './sync.js';

export interface SandboxWatchlistImportOptions {
  clock: Clock;
  /** `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`, parsed. */
  disabled: readonly string[];
  /** `loadMatcherData()` by default. */
  matcherData?: (() => MatcherData) | undefined;
  /** A pool connection of `db` per import by default. */
  connect?: (() => Promise<WatchlistSession>) | undefined;
  logger?: WorkerLogger | undefined;
  manifest?: WatchlistManifest | undefined;
}

/** One imported sandbox list: ids, outcome and counts only. */
export interface SandboxWatchlistImport {
  sourceId: string;
  outcome: WatchlistSyncOutcomeName;
  syncId: number | null;
  entryCount: number;
}

export interface SandboxWatchlistImports {
  lists: SandboxWatchlistImport[];
  /** Why nothing was imported (no variant-group file), for the seed's output; else `null`. */
  warning: string | null;
}

/** The warning when the variant-group file is missing or not the shipped one. */
export const SANDBOX_IMPORT_SKIPPED =
  'watchlists: the sandbox lists were not imported: data/variant-groups.json is missing or not the shipped file; run python3 scripts/fetch_data.py and build it, then seed again (sandbox reports answer list_unavailable until then)';

const QUIET: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** The sync settings of an import: defaults only (an import reads no token or User-Agent). */
function importSettings(disabled: readonly string[]): WatchlistSettings {
  return {
    sourcesDisabled: [...disabled],
    refresh: false,
    removedRetentionDays: PHASE6_DEFAULTS.removedRetentionDays,
    euFsfToken: null,
    wikidataUserAgent: null,
    wikidataSparqlUrl: PHASE6_DEFAULTS.wikidataSparqlUrl,
    pep: {
      openTenureMaxYears: PHASE6_DEFAULTS.pepOpenTenureMaxYears,
      includeRelatives: false,
      retentionMonths: PHASE6_DEFAULTS.pepRetentionMonths,
      headRetentionMonths: PHASE6_DEFAULTS.pepHeadRetentionMonths,
    },
  };
}

/** C76.6: imports each enabled sandbox list from its committed fixture; see the file header. */
export async function importSandboxWatchlists(
  db: Db,
  options: SandboxWatchlistImportOptions,
): Promise<SandboxWatchlistImports> {
  const matcher = (options.matcherData ?? (() => loadMatcherData()))();
  if (matcher.status !== 'loaded') {
    return { lists: [], warning: SANDBOX_IMPORT_SKIPPED };
  }
  const manifest = options.manifest ?? watchlistManifest();
  const sandbox = manifest.sources.filter((source) => source.sandbox_only);
  const enabled = new Set(
    (
      await getWatchlistSourceStates(
        db,
        sandbox.map((source) => source.id),
      )
    )
      .filter((state) => state.enabled)
      .map((state) => state.id),
  );
  const lists: SandboxWatchlistImport[] = [];
  for (const source of sandbox) {
    if (!enabled.has(source.id)) {
      continue;
    }
    const result = await syncWatchlistSource(
      {
        db,
        connect: options.connect ?? watchlistSessionsOf(db),
        clock: options.clock,
        logger: options.logger ?? QUIET,
        settings: importSettings(options.disabled),
        matcherData: () => matcher,
        manifest,
      },
      {
        sourceId: source.id,
        actor: 'seed',
        importPath: fileURLToPath(new URL(`${source.id}.json`, FIXTURES_DIRECTORY)),
      },
    );
    lists.push({
      sourceId: source.id,
      outcome: result.outcome,
      syncId: result.syncId,
      entryCount: result.entryCount,
    });
  }
  return { lists, warning: null };
}
