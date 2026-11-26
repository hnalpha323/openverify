/**
 * C92.2: the command line of `network:sync` (`apps/api/scripts/network-sync.ts`), kept here so
 * Vitest covers it; the script only builds the runtime from the environment and calls these.
 * Every run reconciles the source rows first (C92.5). Output is one line per source: ids,
 * outcomes, counts and codes, never a URL or an address. Owner: `api-network` (Workflow 7A
 * Stage 3).
 */
import { listNetworkSourceStates, type Db } from '@openverify/db';
import type { NetworkSettings } from '../config.js';
import type { OutboundHttp } from '../http/index.js';
import type { WorkerLogger } from '../jobs/logger.js';
import type { Clock, FileStorage } from '../ports.js';
import type { SyncSession } from '../sync/runner.js';
import { networkManifest, networkManifestSource, type NetworkManifest } from './manifest.js';
import { reconcileNetworkSources } from './reconcile.js';
import { ImportOnlyNetworkSourceError, syncNetworkSource, type NetworkSyncResult } from './sync.js';

/** The command line is not valid; the message says what to fix. */
export class NetworkCliUsageError extends Error {
  override name = 'NetworkCliUsageError';
}

export const NETWORK_SYNC_USAGE =
  'usage: network:sync [--source <id>] [--import <file> --source <id>] [--allow-mass-removal] [--allow-mass-addition] [--accept-older-publication] [--json]';

export interface NetworkSyncArgs {
  source: string | null;
  importPath: string | null;
  allowMassRemoval: boolean;
  allowMassAddition: boolean;
  acceptOlderPublication: boolean;
  json: boolean;
}

/** What one CLI run works with (the script builds it from the environment, as the worker). */
export interface NetworkCliRuntime {
  db: Db;
  connect(): Promise<SyncSession>;
  clock: Clock;
  logger: WorkerLogger;
  network: Pick<NetworkSettings, 'sourcesDisabled' | 'sourcesEnabled'>;
  storage?: FileStorage | undefined;
  outboundHttp?: OutboundHttp | undefined;
  manifest?: NetworkManifest | undefined;
  out(line: string): void;
}

/** A manifest source id (`network_sources.id`). */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const SOURCE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const FLAGS: Readonly<Record<string, boolean>> = {
  '--source': true,
  '--import': true,
  '--allow-mass-removal': false,
  '--allow-mass-addition': false,
  '--accept-older-publication': false,
  '--json': false,
};

/**
 * Parses `network:sync`'s command line (`--name=value` or `--name value`).
 * @throws {NetworkCliUsageError} for an unknown flag, a missing value, a malformed source id or
 *   `--import` without `--source`.
 */
export function parseNetworkSyncArgs(argv: readonly string[]): NetworkSyncArgs {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    const takesValue = FLAGS[flag];
    if (takesValue === undefined) {
      throw new NetworkCliUsageError(`Unknown argument ${flag}. ${NETWORK_SYNC_USAGE}`);
    }
    if (!takesValue) {
      flags.set(flag, true);
      continue;
    }
    const given = inline ?? argv[(index += 1)];
    if (given === undefined || given === '') {
      throw new NetworkCliUsageError(`${flag} needs a value. ${NETWORK_SYNC_USAGE}`);
    }
    if (flag === '--source' && !SOURCE_ID.test(given)) {
      throw new NetworkCliUsageError(
        '--source must be a manifest source id such as aws-ip-ranges.',
      );
    }
    flags.set(flag, given);
  }
  const valueOf = (flag: string) => {
    const value = flags.get(flag);
    return typeof value === 'string' ? value : null;
  };
  const source = valueOf('--source');
  const importPath = valueOf('--import');
  if (importPath !== null && source === null) {
    throw new NetworkCliUsageError(
      `--import needs --source, the source the file is loaded into. ${NETWORK_SYNC_USAGE}`,
    );
  }
  return {
    source,
    importPath,
    allowMassRemoval: flags.has('--allow-mass-removal'),
    allowMassAddition: flags.has('--allow-mass-addition'),
    acceptOlderPublication: flags.has('--accept-older-publication'),
    json: flags.has('--json'),
  };
}

function syncLine(result: NetworkSyncResult): string {
  const parts = [
    `${result.sourceId}: ${result.outcome} (sync ${result.syncId === null ? 'none' : String(result.syncId)})`,
    `entries ${String(result.entryCount)}`,
    `bytes ${String(result.snapshotBytes)}`,
  ];
  if (result.origin === 'import') {
    parts.push('import');
  }
  if (result.overrides.length > 0) {
    parts.push(`overrides ${result.overrides.join(' ')}`);
  }
  if (result.purged > 0) {
    parts.push(`purged ${String(result.purged)}`);
  }
  if (result.errorCode !== null) {
    parts.push(`code ${result.errorCode}`);
  }
  return parts.join(', ');
}

/**
 * `network:sync`: the source `--source` names, or every enabled source that downloads (the
 * sandbox source and Azure are imported only), one sync each, one line each.
 * @throws {NetworkCliUsageError} for a source the manifest does not name, or an import-only
 *   source without `--import`.
 */
export async function runNetworkSync(
  args: NetworkSyncArgs,
  runtime: NetworkCliRuntime,
): Promise<NetworkSyncResult[]> {
  const manifest = runtime.manifest ?? networkManifest();
  await reconcileNetworkSources(runtime.db, { ...runtime.network, clock: runtime.clock, manifest });
  let sourceIds: string[];
  if (args.source === null) {
    const enabled = new Set(
      (await listNetworkSourceStates(runtime.db))
        .filter((state) => state.enabled)
        .map((state) => state.id),
    );
    sourceIds = manifest.sources
      .filter(
        (source) =>
          (source.urls.length > 0 || source.url_template !== null) && enabled.has(source.id),
      )
      .map((source) => source.id);
  } else {
    if (networkManifestSource(args.source, manifest) === undefined) {
      throw new NetworkCliUsageError(
        `--source ${args.source} is not a source of network/sources.json.`,
      );
    }
    sourceIds = [args.source];
  }
  const results: NetworkSyncResult[] = [];
  for (const sourceId of sourceIds) {
    let result: NetworkSyncResult;
    try {
      result = await syncNetworkSource(
        {
          db: runtime.db,
          connect: () => runtime.connect(),
          clock: runtime.clock,
          logger: runtime.logger,
          storage: runtime.storage,
          outboundHttp: runtime.outboundHttp,
          manifest,
        },
        {
          sourceId,
          actor: 'cli',
          importPath: args.importPath ?? undefined,
          allowMassRemoval: args.allowMassRemoval,
          allowMassAddition: args.allowMassAddition,
          acceptOlderPublication: args.acceptOlderPublication,
        },
      );
    } catch (error) {
      if (error instanceof ImportOnlyNetworkSourceError) {
        throw new NetworkCliUsageError(error.message);
      }
      throw error;
    }
    results.push(result);
    runtime.out(args.json ? JSON.stringify(result) : syncLine(result));
  }
  return results;
}

/** The process's exit code: 0 when every source applied or stayed unchanged. */
export function networkCliExitCode(results: readonly NetworkSyncResult[]): number {
  return results.every((result) => result.outcome === 'applied' || result.outcome === 'unchanged')
    ? 0
    : 1;
}
