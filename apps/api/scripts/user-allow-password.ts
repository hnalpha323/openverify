/**
 * `pnpm --filter @openverify/api user:allow-password <email> [--organization <org_...>]` (Phase 11,
 * Workflow 11B, `sso-oidc`; C248.6, review F11): the break-glass grant of one password sign-in
 * within 24 hours for a user of an organisation whose SSO provider is enforced. See
 * `src/operator-auth/oidc/allow-password-command.ts`.
 *
 * Reads DATABASE_URL, from the environment or the repository's .env, and runs as the runtime role
 * (Stage 1a amendment 15). Messages name variables, never their values.
 */
import { pathToFileURL } from 'node:url';
import { createDatabase } from '@openverify/db';
import { Pool } from 'pg';
import {
  ALLOW_PASSWORD_USAGE,
  parseAllowPasswordArgs,
  runAllowPassword,
} from '#src/operator-auth/oidc/allow-password-command';
import { systemClock } from '#src/ports';

interface Io {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

/**
 * The command. Bad arguments print the usage and answer 2 before anything connects.
 * @returns the exit code: 0 granted, 1 refused (nothing written), 2 bad arguments or no database.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: Io = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  if (parseAllowPasswordArgs(argv) === null) {
    io.stderr.write(ALLOW_PASSWORD_USAGE);
    return 2;
  }
  const databaseUrl = env.DATABASE_URL ?? '';
  if (databaseUrl === '') {
    io.stderr.write('DATABASE_URL: is required\n');
    return 2;
  }
  /* v8 ignore start -- the connected run, proved through runAllowPassword's tests */
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await runAllowPassword({
      db: createDatabase(pool),
      argv,
      stdout: io.stdout,
      stderr: io.stderr,
      clock: systemClock,
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
        `user:allow-password failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
