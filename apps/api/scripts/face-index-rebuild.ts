/**
 * Rebuilds the face templates after a face model change (C42.7):
 *
 *   pnpm --filter @openverify/api face-index:rebuild [--dry-run] [--batch-size=<1-10000>]
 *
 * Every verification that already has a face template is re-embedded from its stored centre file
 * through the vision service, and its template and background row are rewritten, keeping
 * `created_at`; rows whose files are gone, that show no face, whose consent no longer holds or
 * whose inquiry was redacted, declined or failed are deleted. It never creates a row. One
 * transaction per row, under the inquiry lock (`jobs/face-index-rebuild.ts`). `--dry-run` counts
 * what would happen and writes nothing. Output is counts only, never ids or data.
 *
 * Reads the API's settings (`loadConfig`): DATABASE_URL, the KEK, the S3 store and the vision
 * service, from the environment or the repository's .env; messages name variables, never values.
 */
import { pathToFileURL } from 'node:url';
import { createDatabase, setDefaultKeyring } from '@openverify/db';
import { Pool } from 'pg';
import { ConfigError, loadConfig } from '#src/config';
import { describeJobError } from '#src/jobs/error-description';
import {
  rebuildFaceIndex,
  type FaceIndexRebuildDeps,
  type FaceIndexRebuildReport,
} from '#src/jobs/face-index-rebuild';
import { createWorkerLogger } from '#src/jobs/logger';
import { createFileStorage } from '#src/storage/index';
import { createVisionClient } from '#src/vision/index';

export const DEFAULT_FACE_REBUILD_BATCH_SIZE = 100;
export const MAX_FACE_REBUILD_BATCH_SIZE = 10_000;

export interface FaceIndexRebuildArgs {
  dryRun: boolean;
  batchSize: number;
}

/** The command line is not valid; the message says what to fix. */
export class FaceIndexRebuildUsageError extends Error {
  override name = 'FaceIndexRebuildUsageError';
}

const USAGE = 'usage: face-index:rebuild [--dry-run] [--batch-size=<1-10000>]';

/**
 * Parses the command line (`--dry-run`; `--batch-size=<n>` or `--batch-size <n>`).
 * @throws {FaceIndexRebuildUsageError} for an unknown flag or a bad value.
 */
export function parseFaceIndexRebuildArgs(argv: readonly string[]): FaceIndexRebuildArgs {
  const args: FaceIndexRebuildArgs = { dryRun: false, batchSize: DEFAULT_FACE_REBUILD_BATCH_SIZE };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    if (flag === '--dry-run' && inline === undefined) {
      args.dryRun = true;
      continue;
    }
    if (flag !== '--batch-size') {
      throw new FaceIndexRebuildUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
    const given = inline ?? argv[(index += 1)];
    const size = Number(given);
    if (given === undefined || given === '' || !Number.isInteger(size) || size < 1) {
      throw new FaceIndexRebuildUsageError(
        `--batch-size must be 1 to ${String(MAX_FACE_REBUILD_BATCH_SIZE)}. ${USAGE}`,
      );
    }
    args.batchSize = Math.min(size, MAX_FACE_REBUILD_BATCH_SIZE);
  }
  return args;
}

/** The line the command prints: counts only. */
export function describeFaceIndexRebuild(
  report: FaceIndexRebuildReport,
  args: FaceIndexRebuildArgs,
): string {
  const examined = `examined ${String(report.examined)} templates`;
  return args.dryRun
    ? `face-index:rebuild: dry run: ${examined}, would rewrite ${String(report.rewritten)}, ` +
        `would delete ${String(report.deleted)}; nothing was written.`
    : `face-index:rebuild: done: ${examined}, rewrote ${String(report.rewritten)}, ` +
        `deleted ${String(report.deleted)}, left ${String(report.failed)} after a vision failure.`;
}

/**
 * The line the command prints to stderr when it stops on an error: a usage or configuration
 * message whole (they name flags and variables, never values), anything else by its class and
 * code, since a failed query's message holds its parameters (Workflow 4B review H001).
 */
export function describeFaceIndexRebuildFailure(error: unknown): string {
  return error instanceof FaceIndexRebuildUsageError || error instanceof ConfigError
    ? error.message
    : describeJobError(error);
}

/* v8 ignore start -- process entry point: real Postgres, S3 and vision, run by an operator */
/** The command: settings from the environment, then one run. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseFaceIndexRebuildArgs(argv);
  const config = loadConfig(env);
  setDefaultKeyring(config.keyring);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const storage = createFileStorage({ driver: 's3', ...config.s3 });
  try {
    const deps: FaceIndexRebuildDeps = {
      db: createDatabase(pool),
      storage,
      keyring: config.keyring,
      vision: createVisionClient({
        baseUrl: config.vision.url,
        serviceToken: config.vision.serviceToken,
      }),
      logger: createWorkerLogger({ name: 'openverify-face-index-rebuild', level: config.logLevel }),
    };
    const report = await rebuildFaceIndex(deps, { dryRun: args.dryRun, batchSize: args.batchSize });
    process.stdout.write(`${describeFaceIndexRebuild(report, args)}\n`);
    if (report.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled([storage.close(), pool.end()]);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${describeFaceIndexRebuildFailure(error)}\n`);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
