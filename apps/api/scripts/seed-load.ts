/**
 * C268.3 (Workflow 11D; decision 14 before 11D): the load seed. A development tool, never compiled
 * into the API image (`DEVELOPMENT_TOOLS` in `src/commands-build.test.ts`), run on the host with tsx
 * against the load stack's published Postgres port:
 *
 *   set -a; . /tmp/openverify-load/load.env; set +a
 *   pnpm --filter @openverify/api seed:load --scale <small|reference>
 *     --step <organisations|principals|accounts|inquiries|lists|transactions|graph|connect|watchlists|verify>
 *     [--part <n>] [--secrets-file <path>] [--json]
 *
 * Resumable, each call under 10 minutes (the inquiries, transactions and watchlist steps in parts;
 * `--part 0` prints a step's parts). It refuses production mode and any database whose name is not
 * `openverify_load`, runs as the migration role (`OPENVERIFY_MIGRATION_DATABASE_URL`, else
 * `DATABASE_URL`, through `migrationRoleEnv`, so the `_FILE` forms work), reads only registered
 * variables, and writes the generated secrets (API keys, the users' password, TOTP secrets) only to
 * `--secrets-file` (default /tmp/openverify-load/seed.json), a mode-0600 file under `/tmp`, never
 * to stdout, a log or git. Every value it writes is synthetic: addresses at example.com, client
 * addresses from the documentation ranges, the generators' names; this file is inside the PII
 * scan's scope (`security/gitleaks-pii.toml`, KP11-35). The counts per scenario are
 * `docs/calibration/load-phase11.md`'s spread table (Workflow 11D Stage 1a amendment 10). The logic
 * is `src/seed/load-seed.ts` and `src/seed/load/`; the file operations are this script's.
 */
import { fileURLToPath } from 'node:url';
import { createDatabase, setDefaultKeyring } from '@openverify/db';
import { Pool } from 'pg';
import { migrationRoleEnv } from '#src/migrate';
import { systemClock, ulidIdGenerator } from '#src/ports';
import {
  formatLoadSeedRun,
  loadSeedSettingsFromEnv,
  parseLoadSeedArgs,
  runLoadSeed,
} from '#src/seed/load-seed';
import { nodeFiles as files } from '#src/seed/load/files.test-support';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

async function main(): Promise<void> {
  const args = parseLoadSeedArgs(process.argv.slice(2));
  const settings = loadSeedSettingsFromEnv(migrationRoleEnv(process.env));
  setDefaultKeyring(settings.keyring);
  const pool = new Pool({ connectionString: settings.databaseUrl, max: 4 });
  try {
    const run = await runLoadSeed({
      db: createDatabase(pool),
      pool,
      settings,
      args,
      files,
      ids: ulidIdGenerator,
      clock: systemClock,
      repositoryRoot: REPOSITORY_ROOT,
      out: (line) => process.stderr.write(`${line}\n`),
    });
    process.stdout.write(formatLoadSeedRun(run, args.json));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
