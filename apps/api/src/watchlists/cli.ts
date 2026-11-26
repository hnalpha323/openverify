/**
 * C76.2, C78.3, C80.1: the command lines of `watchlists:sync`, `watchlists:rekey` and `pep:sync`
 * (`apps/api/scripts/{watchlists-sync,watchlists-rekey,pep-sync}.ts`), kept here so Vitest covers
 * them; the scripts only build the runtime from the environment and call these. Owner:
 * `api-watchlists` (Workflow 6A Stage 3).
 *
 * Every run reconciles the source rows first (C76.4). Output is one line per source: ids,
 * outcomes, counts and codes, never a list value, a URL or the EU token (C76.5).
 */
import { getWatchlistSourceStates, type Db } from '@openverify/db';
import type { WatchlistSettings } from '../config.js';
import type { OutboundHttp } from '../http/index.js';
import type { WorkerLogger } from '../jobs/logger.js';
import type { Clock, ReportRescreenQueue } from '../ports.js';
import type { MatcherData } from './matcher-data.js';
import { manifestSource, watchlistManifest, type WatchlistManifest } from './manifest.js';
import { rebuildWatchlistSourceKeyDf, type WatchlistKeyDfRebuildResult } from './rebuild-key-df.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { watchlistReconcileOptIn } from './un-opt-in.js';
import { rekeyWatchlistSource, type WatchlistRekeyResult } from './rekey.js';
import type { WatchlistSession } from './sync-session.js';
import {
  ImportOnlyWatchlistSourceError,
  syncWatchlistSource,
  type WatchlistSyncResult,
} from './sync.js';

/** The command line is not valid; the message says what to fix. */
export class WatchlistCliUsageError extends Error {
  override name = 'WatchlistCliUsageError';
}

export const WATCHLISTS_SYNC_USAGE =
  'usage: watchlists:sync [--source <id>] [--import <file> --source <id>] [--allow-mass-removal] [--accept-older-publication] [--allow-normalised] [--json]';
export const WATCHLISTS_REKEY_USAGE = 'usage: watchlists:rekey [--source <id>] [--json]';
export const PEP_SYNC_USAGE = 'usage: pep:sync [--import <file>] [--json]';
export const WATCHLISTS_REBUILD_KEY_DF_USAGE =
  'usage: watchlists:rebuild-key-df [--source <id>] [--json]';

export interface WatchlistsSyncArgs {
  /** One manifest source; `null` syncs every enabled source that downloads. */
  source: string | null;
  /** A local file in the source's own format, or the normalised JSON (C76.2 imports). */
  importPath: string | null;
  allowMassRemoval: boolean;
  acceptOlderPublication: boolean;
  allowNormalised: boolean;
  json: boolean;
}

export interface WatchlistsRekeyArgs {
  /** One manifest source; `null` re-keys every source that holds keys. */
  source: string | null;
  json: boolean;
}

export interface WatchlistsRebuildKeyDfArgs {
  /** One manifest source; `null` rebuilds every source that holds keys. */
  source: string | null;
  json: boolean;
}

export interface PepSyncArgs {
  importPath: string | null;
  json: boolean;
}

/** A manifest source id (`watchlist_sources.id`). */
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Reads `--name=value` or `--name value` flags; `known` maps each flag to whether it takes a value. */
function readFlags(
  argv: readonly string[],
  known: Readonly<Record<string, boolean>>,
  usage: string,
): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    const takesValue = known[flag];
    if (takesValue === undefined) {
      throw new WatchlistCliUsageError(`Unknown argument ${flag}. ${usage}`);
    }
    if (!takesValue) {
      flags.set(flag, true);
      continue;
    }
    const given = inline ?? argv[(index += 1)];
    if (given === undefined || given === '') {
      throw new WatchlistCliUsageError(`${flag} needs a value. ${usage}`);
    }
    if (flag === '--source' && !SOURCE_ID.test(given)) {
      throw new WatchlistCliUsageError('--source must be a manifest source id such as ofac-sdn.');
    }
    flags.set(flag, given);
  }
  return flags;
}

const valueOf = (flags: Map<string, string | true>, flag: string): string | null => {
  const value = flags.get(flag);
  return typeof value === 'string' ? value : null;
};

/**
 * Parses `watchlists:sync`'s command line (`--name=value` or `--name value`).
 * @throws {WatchlistCliUsageError} for an unknown flag, a missing value or `--import` alone.
 */
export function parseWatchlistsSyncArgs(argv: readonly string[]): WatchlistsSyncArgs {
  const flags = readFlags(
    argv,
    {
      '--source': true,
      '--import': true,
      '--allow-mass-removal': false,
      '--accept-older-publication': false,
      '--allow-normalised': false,
      '--json': false,
    },
    WATCHLISTS_SYNC_USAGE,
  );
  const source = valueOf(flags, '--source');
  const importPath = valueOf(flags, '--import');
  if (importPath !== null && source === null) {
    throw new WatchlistCliUsageError(
      `--import needs --source, the source the file is loaded into. ${WATCHLISTS_SYNC_USAGE}`,
    );
  }
  return {
    source,
    importPath,
    allowMassRemoval: flags.has('--allow-mass-removal'),
    acceptOlderPublication: flags.has('--accept-older-publication'),
    allowNormalised: flags.has('--allow-normalised'),
    json: flags.has('--json'),
  };
}

/** Parses `watchlists:rekey`'s command line. */
export function parseWatchlistsRekeyArgs(argv: readonly string[]): WatchlistsRekeyArgs {
  const flags = readFlags(argv, { '--source': true, '--json': false }, WATCHLISTS_REKEY_USAGE);
  return { source: valueOf(flags, '--source'), json: flags.has('--json') };
}

/** Parses `watchlists:rebuild-key-df`'s command line. */
export function parseWatchlistsRebuildKeyDfArgs(
  argv: readonly string[],
): WatchlistsRebuildKeyDfArgs {
  const flags = readFlags(
    argv,
    { '--source': true, '--json': false },
    WATCHLISTS_REBUILD_KEY_DF_USAGE,
  );
  return { source: valueOf(flags, '--source'), json: flags.has('--json') };
}

/** Parses `pep:sync`'s command line. */
export function parsePepSyncArgs(argv: readonly string[]): PepSyncArgs {
  const flags = readFlags(argv, { '--import': true, '--json': false }, PEP_SYNC_USAGE);
  return { importPath: valueOf(flags, '--import'), json: flags.has('--json') };
}

/** What one CLI run works with (the scripts build it from the environment, as the worker). */
export interface WatchlistCliRuntime {
  db: Db;
  connect(): Promise<WatchlistSession>;
  clock: Clock;
  logger: WorkerLogger;
  settings: WatchlistSettings;
  outboundHttp?: OutboundHttp | undefined;
  rescreens?: ReportRescreenQueue | undefined;
  matcherData(): MatcherData;
  manifest?: WatchlistManifest | undefined;
  /** One line per source. */
  out(line: string): void;
}

function syncLine(result: WatchlistSyncResult): string {
  const parts = [
    `${result.sourceId}: ${result.outcome} (sync ${result.syncId === null ? 'none' : String(result.syncId)})`,
    `entries ${String(result.entryCount)}`,
    `added ${String(result.added)}`,
    `changed ${String(result.changed)}`,
    `removed ${String(result.removed)}`,
  ];
  if (result.rekeyed) {
    parts.push('re-keyed first');
  }
  if (result.rescreen !== 'none') {
    parts.push(`re-screen ${result.rescreen}`);
  }
  if (result.errorCode !== null) {
    parts.push(`code ${result.errorCode}`);
  }
  return parts.join(', ');
}

function knownSource(id: string, manifest: WatchlistManifest): void {
  if (manifestSource(id, manifest) === undefined) {
    throw new WatchlistCliUsageError(`--source ${id} is not a source of watchlists/sources.json.`);
  }
}

/** The source `--source` names, or every source of the manifest that holds keys, in its order. */
async function chosenSources(
  source: string | null,
  runtime: WatchlistCliRuntime,
  manifest: WatchlistManifest,
): Promise<string[]> {
  if (source !== null) {
    knownSource(source, manifest);
    return [source];
  }
  const ids = manifest.sources.map((item) => item.id);
  const keyed = new Set(
    (await getWatchlistSourceStates(runtime.db, ids))
      .filter((state) => state.keysVersion !== null)
      .map((state) => state.id),
  );
  return ids.filter((id) => keyed.has(id));
}

async function reconciled(runtime: WatchlistCliRuntime): Promise<WatchlistManifest> {
  const manifest = runtime.manifest ?? watchlistManifest();
  await reconcileWatchlistSources(runtime.db, {
    disabled: runtime.settings.sourcesDisabled,
    manifest,
    // C254.1 (Q10 granted; KP11-31): an environment's recorded UN opt-in, while allowed.
    ...(await watchlistReconcileOptIn(runtime.db, runtime.settings.unOptInAllowed === true)),
  });
  return manifest;
}

/**
 * `watchlists:sync`: the source `--source` names, or every enabled source that downloads, one
 * sync each, one line each.
 * @throws {WatchlistCliUsageError} for a source the manifest does not name, or an import-only
 * source without `--import`.
 */
export async function runWatchlistsSync(
  args: WatchlistsSyncArgs,
  runtime: WatchlistCliRuntime,
): Promise<WatchlistSyncResult[]> {
  const manifest = await reconciled(runtime);
  let sourceIds: string[];
  if (args.source === null) {
    const enabled = new Set(
      (
        await getWatchlistSourceStates(
          runtime.db,
          manifest.sources.map((source) => source.id),
        )
      )
        .filter((state) => state.enabled)
        .map((state) => state.id),
    );
    sourceIds = manifest.sources
      .filter((source) => source.urls.length > 0 && enabled.has(source.id))
      .map((source) => source.id);
  } else {
    knownSource(args.source, manifest);
    sourceIds = [args.source];
  }
  const results: WatchlistSyncResult[] = [];
  for (const sourceId of sourceIds) {
    let result: WatchlistSyncResult;
    try {
      result = await syncWatchlistSource(
        {
          db: runtime.db,
          connect: () => runtime.connect(),
          clock: runtime.clock,
          logger: runtime.logger,
          settings: runtime.settings,
          outboundHttp: runtime.outboundHttp,
          rescreens: runtime.rescreens,
          matcherData: () => runtime.matcherData(),
          manifest,
        },
        {
          sourceId,
          actor: 'cli',
          importPath: args.importPath ?? undefined,
          allowMassRemoval: args.allowMassRemoval,
          acceptOlderPublication: args.acceptOlderPublication,
          allowNormalised: args.allowNormalised,
        },
      );
    } catch (error) {
      if (error instanceof ImportOnlyWatchlistSourceError) {
        throw new WatchlistCliUsageError(error.message);
      }
      throw error;
    }
    results.push(result);
    runtime.out(args.json ? JSON.stringify(result) : syncLine(result));
  }
  return results;
}

/**
 * `watchlists:rekey`: the source `--source` names, or every source that holds keys.
 * @throws {WatchlistCliUsageError} for a source the manifest does not name.
 */
export async function runWatchlistsRekey(
  args: WatchlistsRekeyArgs,
  runtime: WatchlistCliRuntime,
): Promise<WatchlistRekeyResult[]> {
  const manifest = await reconciled(runtime);
  const sourceIds = await chosenSources(args.source, runtime, manifest);
  const results: WatchlistRekeyResult[] = [];
  for (const sourceId of sourceIds) {
    const result = await rekeyWatchlistSource(
      {
        db: runtime.db,
        connect: () => runtime.connect(),
        clock: runtime.clock,
        logger: runtime.logger,
        matcherData: () => runtime.matcherData(),
        manifest,
      },
      { sourceId, actor: 'cli' },
    );
    results.push(result);
    runtime.out(
      args.json
        ? JSON.stringify(result)
        : `${sourceId}: ${result.outcome} (sync ${String(result.syncId)}), entries ${String(result.entries)}`,
    );
  }
  return results;
}

/**
 * `watchlists:rebuild-key-df` (C270.1): the full rebuild of the key frequencies of the source
 * `--source` names, or of every source that holds keys.
 * @throws {WatchlistCliUsageError} for a source the manifest does not name.
 */
export async function runWatchlistsRebuildKeyDf(
  args: WatchlistsRebuildKeyDfArgs,
  runtime: WatchlistCliRuntime,
): Promise<WatchlistKeyDfRebuildResult[]> {
  const manifest = await reconciled(runtime);
  const sourceIds = await chosenSources(args.source, runtime, manifest);
  const results: WatchlistKeyDfRebuildResult[] = [];
  for (const sourceId of sourceIds) {
    const result = await rebuildWatchlistSourceKeyDf(
      {
        db: runtime.db,
        connect: () => runtime.connect(),
        logger: runtime.logger,
        manifest,
      },
      { sourceId },
    );
    results.push(result);
    runtime.out(
      args.json
        ? JSON.stringify(result)
        : `${sourceId}: ${result.outcome}, ${String(result.keys)} keys`,
    );
  }
  return results;
}

/** `watchlists:rebuild-key-df`'s exit code: 0 when every source was rebuilt. */
export function watchlistRebuildKeyDfExitCode(
  results: readonly WatchlistKeyDfRebuildResult[],
): number {
  return results.every((result) => result.outcome === 'rebuilt') ? 0 : 1;
}

/** `pep:sync`: the `wikidata-pep` source, from the query service or an `--import`. */
export function runPepSync(
  args: PepSyncArgs,
  runtime: WatchlistCliRuntime,
): Promise<WatchlistSyncResult[]> {
  return runWatchlistsSync(
    {
      source: 'wikidata-pep',
      importPath: args.importPath,
      allowMassRemoval: false,
      acceptOlderPublication: false,
      allowNormalised: false,
      json: args.json,
    },
    runtime,
  );
}

const SUCCESSFUL = new Set(['applied', 'unchanged', 'rekeyed']);

/** The process's exit code: 0 when every source applied, stayed unchanged or was re-keyed. */
export function watchlistCliExitCode(
  results: readonly (WatchlistSyncResult | WatchlistRekeyResult)[],
): number {
  return results.every((result) => SUCCESSFUL.has(result.outcome)) ? 0 : 1;
}
