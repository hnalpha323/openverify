/**
 * `pnpm --filter @openverify/api api-keys:pepper-status [--json]` (Phase 11, Workflow 11B,
 * auth-sessions; C247.1): how many API keys each pepper holds. See
 * `src/operator-commands/api-keys-pepper-status.ts`.
 *
 * Reads the API's settings (`loadConfig`: DATABASE_URL, OPENVERIFY_API_KEY_PEPPER and
 * OPENVERIFY_API_KEY_PEPPER_PREVIOUS, or their `_FILE` forms) from the environment or the
 * repository's .env. It runs as the runtime role (Stage 1a amendment 15). It prints pepper ids and
 * counts, never a key or a hash.
 */
import { pathToFileURL } from 'node:url';
import { createDatabase } from '@openverify/db';
import { Pool } from 'pg';
import {
  PEPPER_STATUS_USAGE,
  runPepperStatus,
} from '#src/operator-commands/api-keys-pepper-status';
import { loadConfig } from '#src/config';

interface Io {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

/**
 * The command. An argument it does not know prints the usage and answers 2 before anything
 * connects.
 * @returns the exit code: 0 done, 2 bad arguments.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: Io = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  if (!(argv.length === 0 || (argv.length === 1 && argv[0] === '--json'))) {
    io.stderr.write(PEPPER_STATUS_USAGE);
    return 2;
  }
  /* v8 ignore start -- the connected run, proved through runPepperStatus's tests */
  const config = loadConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    return await runPepperStatus({
      db: createDatabase(pool),
      current: config.apiKeyPepper,
      previous: config.apiKeyPepperPrevious,
      argv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
  } finally {
    await pool.end();
  }
  /* v8 ignore stop */
}

/* v8 ignore start -- the entry point, run by the package script only */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `api-keys:pepper-status failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
