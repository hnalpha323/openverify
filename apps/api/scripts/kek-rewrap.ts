/**
 * Rewraps every stored data key under the current KEK (C16):
 *
 *   pnpm --filter @openverify/api kek:rewrap [--dry-run] [--batch-size=<1-10000>]
 *                                            [--state-file=<path>] [--restart]
 *
 * Rotate the KEK by setting the new key as `OPENVERIFY_KEK` and the old one in
 * `OPENVERIFY_KEK_PREVIOUS`, then run this command. Every encrypted column of every table is
 * rewrapped in batches (payloads are never decrypted); once it reports `done`, the old key can
 * be removed from `OPENVERIFY_KEK_PREVIOUS`.
 *
 * - `--dry-run` counts what would change and writes nothing.
 * - The position (table and last row id) is saved after every batch to the state file
 *   (default: `node_modules/.cache/openverify/kek-rewrap.json` of this package, which git
 *   ignores). An interrupted run resumes from it; `--restart` ignores it. It is removed once the
 *   run is done.
 * - Output is counts only, never ids or data.
 *
 * Reads DATABASE_URL (OPENVERIFY_MIGRATION_DATABASE_URL in its place when set: C249.3, the
 * migration role), OPENVERIFY_KEK and OPENVERIFY_KEK_PREVIOUS from the environment or the
 * repository's .env; messages name the variables, never their values.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safeUrl } from '@openverify/contracts';
import {
  createDatabase,
  keyringFromEnv,
  REWRAP_TABLES,
  rewrapAll,
  type Db,
  type Keyring,
  type RewrapSummary,
  type RewrapTable,
} from '@openverify/db';
import { Pool } from 'pg';
import { migrationRoleEnv } from '#src/migrate';

export const DEFAULT_BATCH_SIZE = 500;
export const MAX_BATCH_SIZE = 10_000;
export const DEFAULT_STATE_FILE = fileURLToPath(
  new URL('../node_modules/.cache/openverify/kek-rewrap.json', import.meta.url),
);

export interface KekRewrapArgs {
  dryRun: boolean;
  batchSize: number;
  stateFile: string;
  restart: boolean;
}

/** The command line is not valid; the message says what to fix. */
export class KekRewrapUsageError extends Error {
  override name = 'KekRewrapUsageError';
}

const USAGE =
  'usage: kek:rewrap [--dry-run] [--batch-size=<1-10000>] [--state-file=<path>] [--restart]';

/**
 * Parses the command line (`--name=value` or `--name value`).
 * @throws {KekRewrapUsageError} for an unknown flag or a bad value.
 */
export function parseKekRewrapArgs(argv: readonly string[]): KekRewrapArgs {
  const args: KekRewrapArgs = {
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
    stateFile: DEFAULT_STATE_FILE,
    restart: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    const [flag = '', inline] = argument.split(/=(.*)/s, 2);
    const value = (): string => {
      const given = inline ?? argv[(index += 1)];
      if (given === undefined || given === '') {
        throw new KekRewrapUsageError(`${flag} needs a value. ${USAGE}`);
      }
      return given;
    };
    switch (flag) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--restart':
        args.restart = true;
        break;
      case '--batch-size': {
        const size = Number(value());
        if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) {
          throw new KekRewrapUsageError(`--batch-size must be 1 to ${String(MAX_BATCH_SIZE)}.`);
        }
        args.batchSize = size;
        break;
      }
      case '--state-file':
        args.stateFile = value();
        break;
      default:
        throw new KekRewrapUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
  }
  return args;
}

/** Where an interrupted run stopped: rewrapping continues in `table` after `after`. */
export interface KekRewrapState {
  table: RewrapTable;
  after: string | null;
}

export interface KekRewrapStateStore {
  read(): Promise<KekRewrapState | null>;
  write(state: KekRewrapState): Promise<void>;
  clear(): Promise<void>;
}

/** Keeps the position in memory, for tests. */
export function memoryStateStore(): KekRewrapStateStore {
  let saved: KekRewrapState | null = null;
  return {
    read: () => Promise.resolve(saved === null ? null : { ...saved }),
    write: (state) => {
      saved = { ...state };
      return Promise.resolve();
    },
    clear: () => {
      saved = null;
      return Promise.resolve();
    },
  };
}

/** Keeps the position in a JSON file; an unreadable file counts as no position. */
export function fileStateStore(path: string): KekRewrapStateStore {
  return {
    async read() {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- the state file the operator names with --state-file, or its default beside the script
        const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<KekRewrapState>;
        return typeof parsed.table === 'string'
          ? { table: parsed.table, after: typeof parsed.after === 'string' ? parsed.after : null }
          : null;
      } catch {
        return null;
      }
    },
    async write(state) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the state file the operator names with --state-file, or its default beside the script
      await mkdir(dirname(path), { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the state file the operator names with --state-file, or its default beside the script
      await writeFile(path, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}

export interface RunKekRewrapOptions {
  db: Db;
  /** The new KEK as current, the old ones as previous. */
  keyring: Keyring;
  args: KekRewrapArgs;
  state: KekRewrapStateStore;
  /** Prints one line; counts only. */
  out: (line: string) => void;
}

const isRewrapTable = (table: string): table is RewrapTable =>
  (REWRAP_TABLES as readonly string[]).includes(table);

const counts = (scanned: number, rewrapped: number) =>
  `scanned ${String(scanned)} rows, rewrapped ${String(rewrapped)} values`;

/** One run: resumes from the saved position unless `--restart`, saves it after each batch. */
export async function runKekRewrap(options: RunKekRewrapOptions): Promise<RewrapSummary> {
  const { db, keyring, args, state, out } = options;
  const saved = args.restart ? null : await state.read();
  const resume = saved !== null && isRewrapTable(saved.table) ? saved : undefined;
  if (resume !== undefined) {
    out(`kek:rewrap: resuming at table ${resume.table}`);
  }
  let table: { name: RewrapTable; scanned: number; rewrapped: number } | undefined;
  const summary = await rewrapAll(db, {
    keyring,
    batchSize: args.batchSize,
    dryRun: args.dryRun,
    ...(resume === undefined ? {} : { resume }),
    onBatch: async (batch) => {
      if (table?.name !== batch.table) {
        table = { name: batch.table, scanned: 0, rewrapped: 0 };
      }
      table.scanned += batch.scanned;
      table.rewrapped += batch.rewrapped;
      if (batch.next === null) {
        out(`kek:rewrap: ${batch.table}: ${counts(table.scanned, table.rewrapped)}`);
      }
      if (!args.dryRun) {
        const position = REWRAP_TABLES.indexOf(batch.table);
        const following = REWRAP_TABLES[position + 1];
        if (batch.next !== null) {
          await state.write({ table: batch.table, after: batch.next });
        } else if (following !== undefined) {
          await state.write({ table: following, after: null });
        }
      }
    },
  });
  if (!args.dryRun) {
    await state.clear();
  }
  out(
    `kek:rewrap: done: ${counts(summary.scanned, summary.rewrapped)}.` +
      (args.dryRun ? ' (dry run: nothing was written)' : ''),
  );
  return summary;
}

/** The command: settings from the environment, then one run. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseKekRewrapArgs(argv);
  // C249.3: kek:rewrap rewrites audit ciphertexts, so it runs as the migration role.
  const roleEnv = migrationRoleEnv(env);
  const url = roleEnv.DATABASE_URL?.trim() ?? '';
  const protocol = safeUrl(url)?.protocol;
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('OPENVERIFY_MIGRATION_DATABASE_URL or DATABASE_URL: must be a postgres:// URL');
  }
  const keyring = keyringFromEnv(roleEnv);
  const pool = new Pool({ connectionString: url });
  try {
    await runKekRewrap({
      db: createDatabase(pool),
      keyring,
      args,
      state: fileStateStore(args.stateFile),
      out: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
