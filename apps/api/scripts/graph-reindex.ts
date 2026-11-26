/**
 * C101.5 (Workflow 7B): indexes the account graph again on demand, with the backfill's code:
 *
 *   pnpm --filter @openverify/api graph:reindex [--environment <env_…>] [--batch-size=<1-10000>]
 *
 * Every account and inquiry of the environment, or of every environment, in bounded batches. Output
 * is counts only, never ids or values. Reads DATABASE_URL, OPENVERIFY_KEK (and
 * OPENVERIFY_KEK_PREVIOUS) and OPENVERIFY_BLIND_INDEX_KEY from the environment or the repository's
 * .env; messages name the variables, never their values. The run itself is `api-graph`'s
 * (`runGraphReindex`, `services/graph/reindex.ts`).
 */
import { pathToFileURL } from 'node:url';
import { isId, safeUrl } from '@openverify/contracts';
import {
  blindIndexKeyFromEnv,
  createDatabase,
  keyringFromEnv,
  setDefaultKeyring,
} from '@openverify/db';
import { Pool } from 'pg';
import { runGraphReindex, type GraphReindexOptions } from '#src/services/graph/reindex';

export const DEFAULT_REINDEX_BATCH_SIZE = 500;
export const MAX_REINDEX_BATCH_SIZE = 10_000;

const USAGE = 'usage: graph:reindex [--environment <env_…>] [--batch-size=<1-10000>]';

/** The command line is not valid; the message says what to fix. */
export class GraphReindexUsageError extends Error {
  override name = 'GraphReindexUsageError';
}

/**
 * Parses the command line (`--flag=<value>` or `--flag <value>`).
 * @throws {GraphReindexUsageError} for an unknown flag or a bad value.
 */
export function parseGraphReindexArgs(argv: readonly string[]): GraphReindexOptions {
  const options: GraphReindexOptions = { batchSize: DEFAULT_REINDEX_BATCH_SIZE };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    const given = inline ?? argv[(index += 1)];
    if (flag === '--environment') {
      if (given === undefined || !isId('env', given)) {
        throw new GraphReindexUsageError(`--environment must be an env_ id. ${USAGE}`);
      }
      options.environmentId = given;
    } else if (flag === '--batch-size') {
      const size = Number(given);
      if (given === undefined || given === '' || !Number.isInteger(size) || size < 1) {
        throw new GraphReindexUsageError(
          `--batch-size must be 1 to ${String(MAX_REINDEX_BATCH_SIZE)}. ${USAGE}`,
        );
      }
      options.batchSize = Math.min(size, MAX_REINDEX_BATCH_SIZE);
    } else {
      throw new GraphReindexUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
  }
  return options;
}

/** The command: settings from the environment, then one run. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  out: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<void> {
  const options = parseGraphReindexArgs(argv);
  const url = env.DATABASE_URL?.trim() ?? '';
  const protocol = safeUrl(url)?.protocol;
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL: must be a postgres:// URL');
  }
  const blindIndexKey = blindIndexKeyFromEnv(env);
  setDefaultKeyring(keyringFromEnv(env));
  const pool = new Pool({ connectionString: url });
  try {
    const result = await runGraphReindex({ db: createDatabase(pool), blindIndexKey }, options);
    out(
      `graph:reindex: done: ${String(result.environments)} environments, ` +
        `${String(result.accounts)} accounts, ${String(result.inquiries)} inquiries, ` +
        `${String(result.rows)} rows.`,
    );
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
