/**
 * Resets an operator's MFA: `pnpm --filter @openverify/api user:reset-mfa <email>
 * [--organization <org_...>]`. See `src/operator-auth/reset-mfa-command.ts`.
 *
 * Reads DATABASE_URL like the API does, from the environment or the repository's .env (see
 * .env.example). Messages name variables, never their values.
 */
import { createDatabase } from '@openverify/db';
import { Pool } from 'pg';
import { runResetMfa } from '#src/operator-auth/reset-mfa-command';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    process.stderr.write('DATABASE_URL: is required\n');
    process.exitCode = 2;
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    process.exitCode = await runResetMfa({
      db: createDatabase(pool),
      argv: process.argv.slice(2),
      stdout: process.stdout,
      stderr: process.stderr,
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `user:reset-mfa failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
