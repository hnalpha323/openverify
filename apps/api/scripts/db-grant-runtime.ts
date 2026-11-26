/**
 * `pnpm --filter @openverify/api db:grant-runtime <role>` (Phase 11, Workflow 11B, platform-ops;
 * C249.3): grants the runtime role its privileges, run as the migration role. See
 * `src/operator-commands/db-grant-runtime.ts`.
 *
 * Reads OPENVERIFY_MIGRATION_DATABASE_URL (else DATABASE_URL, with a production warning) from the
 * environment or the repository's .env. Messages name variables, never their values.
 */
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { runDbGrantRuntime } from '#src/operator-commands/db-grant-runtime';

interface Io {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

/**
 * The command. Bad arguments print the usage and answer 2 before anything connects.
 * @returns the exit code: 0 granted, 1 refused (nothing granted), 2 bad arguments.
 */
export function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: Io = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  return runDbGrantRuntime({
    argv,
    env,
    stdout: io.stdout,
    stderr: io.stderr,
    /* v8 ignore start -- the connection, proved by runtime-role.integration.test.ts */
    connect: async (url) => {
      const client = new Client({ connectionString: url });
      await client.connect();
      return { connection: client, close: () => client.end() };
    },
    /* v8 ignore stop */
  });
}

/* v8 ignore start -- the entry point, run by the package script only */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`db:grant-runtime: ${(error as Error).message}\n`);
      process.exitCode = 1;
    },
  );
}
/* v8 ignore stop */
