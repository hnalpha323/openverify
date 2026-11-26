/**
 * C62.7: fills the CSCA trust store from the sources of `trust-anchors/manifest.json`:
 *
 *   pnpm --filter @openverify/api trust-anchors:sync [--source <id>] [--import <file> --root <pem>]
 *
 * (wrapped by `scripts/fetch_trust_anchors.sh`). It runs `selfTest()` first, fetches each enabled
 * source's master list and CRLs through the outbound client, verifies each against the pinned
 * root, and applies it in one transaction per source; `--import` reads a master list from a file
 * instead, verified against the root certificate `--root`. It never runs in CI. It exits 1 when
 * a source was refused or failed; each line names codes and counts only (`api-nfc`).
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDatabase, syncTrustAnchorSources, type Db } from '@openverify/db';
import type { SelfTestResult } from '@openverify/emrtd';
import { Pool } from 'pg';
import { createOutboundHttp, type OutboundHttp } from '#src/http/index';
import { systemClock, type Clock } from '#src/ports';
import { loadTrustAnchorManifest } from '#src/trust-anchors/load';
import type { TrustAnchorManifest } from '#src/trust-anchors/manifest';
import {
  importTrustAnchorList,
  syncTrustAnchors,
  type TrustSyncOutcome,
} from '#src/trust-anchors/sync';

export interface TrustAnchorSyncArgs {
  /** Sync only this manifest source; `null` syncs every enabled one. */
  source: string | null;
  /** A master list read from a file and verified against a root certificate (PEM). */
  import: { file: string; root: string } | null;
}

/** The command line is not valid; the message says what to fix. */
export class TrustAnchorSyncUsageError extends Error {
  override name = 'TrustAnchorSyncUsageError';
}

const USAGE = 'usage: trust-anchors:sync [--source <id>] [--import <file> --root <pem>]';
/** A manifest source id (`trust_anchor_sources.id`). */
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{1,31}$/;

/**
 * Parses the command line (`--name=value` or `--name value`).
 * @throws {TrustAnchorSyncUsageError} for an unknown flag or a bad value.
 */
export function parseTrustAnchorSyncArgs(argv: readonly string[]): TrustAnchorSyncArgs {
  let source: string | null = null;
  let file: string | null = null;
  let root: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    const value = (): string => {
      const given = inline ?? argv[(index += 1)];
      if (given === undefined || given === '') {
        throw new TrustAnchorSyncUsageError(`${flag} needs a value. ${USAGE}`);
      }
      return given;
    };
    switch (flag) {
      case '--source':
        source = value();
        if (!SOURCE_ID.test(source)) {
          throw new TrustAnchorSyncUsageError(
            '--source must be a manifest source id such as bsi-de.',
          );
        }
        break;
      case '--import':
        file = value();
        break;
      case '--root':
        root = value();
        break;
      default:
        throw new TrustAnchorSyncUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
  }
  if (file !== null && root === null) {
    throw new TrustAnchorSyncUsageError(
      '--import needs --root, the PEM root certificate to verify it with.',
    );
  }
  if (root !== null && file === null) {
    throw new TrustAnchorSyncUsageError('--root is read only with --import.');
  }
  return { source, import: file === null || root === null ? null : { file, root } };
}

/** What one run of the sync works with (the entry point builds it from the environment). */
export interface TrustAnchorSyncRuntime {
  db: Db;
  outboundHttp: OutboundHttp;
  clock: Clock;
  manifest: TrustAnchorManifest;
  /** `OPENVERIFY_NFC_ALLOW_ICAO_CRLS`. */
  allowIcaoCrls: boolean;
  /** Reads an `--import` or `--root` file. */
  readFile: (path: string) => Promise<Uint8Array>;
  /** One line per source: codes and counts only. */
  out: (line: string) => void;
  selfTest?: (() => SelfTestResult) | undefined;
}

/**
 * One sync as `args` asks: every enabled manifest source, the one `--source` names, or a list
 * read from a file (`--import`) against the root certificate `--root`, applied to `--source` or
 * to the `operator-import` source. Prints one line per source.
 * @throws {TrustAnchorSyncUsageError} for a `--source` the manifest does not name.
 */
export async function runTrustAnchorSync(
  args: TrustAnchorSyncArgs,
  runtime: TrustAnchorSyncRuntime,
): Promise<TrustSyncOutcome[]> {
  const { manifest } = runtime;
  if (args.source !== null && !manifest.sources.some((source) => source.id === args.source)) {
    throw new TrustAnchorSyncUsageError(
      `--source ${args.source} is not a source of trust-anchors/manifest.json.`,
    );
  }
  const deps = {
    db: runtime.db,
    outboundHttp: runtime.outboundHttp,
    clock: runtime.clock,
    allowIcaoCrls: runtime.allowIcaoCrls,
    selfTest: runtime.selfTest,
    log: runtime.out,
  };
  if (args.import === null) {
    return syncTrustAnchors(deps, manifest, { source: args.source });
  }
  await syncTrustAnchorSources(
    runtime.db,
    manifest.sources.map((source) => ({ id: source.id, enabled: source.enabled })),
  );
  return [
    await importTrustAnchorList(deps, {
      list: await runtime.readFile(args.import.file),
      root: await runtime.readFile(args.import.root),
      sourceId: args.source,
    }),
  ];
}

/** `OPENVERIFY_NFC_ALLOW_ICAO_CRLS`, as the API's configuration reads a boolean. */
function allowIcaoCrlsOf(env: NodeJS.ProcessEnv): boolean {
  const value = env.OPENVERIFY_NFC_ALLOW_ICAO_CRLS?.trim().toLowerCase() ?? '';
  if (value === '' || value === 'false' || value === '0') {
    return false;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  throw new TrustAnchorSyncUsageError('OPENVERIFY_NFC_ALLOW_ICAO_CRLS must be true or false.');
}

/* v8 ignore start -- the entry point runs against a real stack, never in CI */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve()
    .then(async () => {
      const args = parseTrustAnchorSyncArgs(process.argv.slice(2));
      const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
      if (databaseUrl === '') {
        throw new TrustAnchorSyncUsageError('DATABASE_URL is required.');
      }
      const pool = new Pool({ connectionString: databaseUrl });
      const outboundHttp = createOutboundHttp();
      try {
        const outcomes = await runTrustAnchorSync(args, {
          db: createDatabase(pool),
          outboundHttp,
          clock: systemClock,
          manifest: await loadTrustAnchorManifest(),
          allowIcaoCrls: allowIcaoCrlsOf(process.env),
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- the --import and --root files the operator names on the command line
          readFile: async (path) => new Uint8Array(await readFile(path)),
          out: (line) => process.stdout.write(`${line}\n`),
        });
        if (outcomes.some((outcome) => outcome.outcome !== 'accepted')) {
          process.exitCode = 1;
        }
      } finally {
        await outboundHttp.close();
        await pool.end();
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
