/**
 * Applies pending database migrations and the data steps they need (`src/migrate.ts`):
 * `pnpm --filter @openverify/api db:migrate`. Safe to run on every deploy; reads
 * OPENVERIFY_MIGRATION_DATABASE_URL (the migration role; else DATABASE_URL, with a production
 * warning), OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS and, for databases upgraded from Phase 1,
 * OPENVERIFY_KEK, from the environment or the repository's .env.
 *
 * C249.4: two runs at once serialise on the migrate lock; a run that waits past the timeout exits
 * 75 (`migrate_lock_timeout`): run it again.
 */
import { createWorkerLogger } from '#src/jobs/logger';
import { runMigrateCommand } from '#src/migrate';

process.exitCode = await runMigrateCommand(process.env, {
  out: (line) => process.stdout.write(`${line}\n`),
  logger: createWorkerLogger({ name: 'openverify-migrate' }),
});
