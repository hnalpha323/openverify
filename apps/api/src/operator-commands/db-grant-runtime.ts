/**
 * `pnpm --filter @openverify/api db:grant-runtime <role>` (C249.3; Phase 11, Workflow 11B,
 * platform-ops): run as the migration role (`OPENVERIFY_MIGRATION_DATABASE_URL`, else
 * `DATABASE_URL` with the production warning `migration_url_unset`), it grants the runtime role
 * its privileges through `grantRuntimeRole` (`@openverify/db`): never `CREATE`, `SELECT, INSERT`
 * only on the append-only tables, `MAINTAIN` on the tables the runtime analyzes. Output is counts.
 */
import { grantRuntimeRole, RuntimeRoleError, type RuntimeGrantConnection } from '@openverify/db';
import { ConfigError } from '../config.js';
import { applyStoreTls } from '../config/store-tls.js';
import { migrateSettingsFromEnv, migrateStartWarnings } from '../migrate.js';

export const DB_GRANT_RUNTIME_USAGE = [
  'Usage: pnpm --filter @openverify/api db:grant-runtime <role>',
  '',
  'Run as the migration role (OPENVERIFY_MIGRATION_DATABASE_URL). Grants the runtime role that the',
  'API and the worker connect as (DATABASE_URL) what they need and nothing that runs DDL. Run it',
  'after every db:migrate that adds a table, or once: later tables get the default privileges.',
  '',
].join('\n');

interface Writable {
  write(chunk: string): unknown;
}

/** One connection to the migration role's database, and how to close it. */
export interface GrantConnection {
  connection: RuntimeGrantConnection;
  close(): Promise<void>;
}

export interface RunDbGrantRuntimeOptions {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdout: Writable;
  stderr: Writable;
  /** Opens one connection to `url`. */
  connect: (url: string) => Promise<GrantConnection>;
}

/** Runs the command. Exit codes: 0 granted, 1 refused (nothing granted), 2 bad arguments. */
export async function runDbGrantRuntime(options: RunDbGrantRuntimeOptions): Promise<number> {
  const { argv, stdout, stderr } = options;
  const [role] = argv;
  if (argv.length !== 1 || role === undefined || role.startsWith('-')) {
    stderr.write(DB_GRANT_RUNTIME_USAGE);
    return 2;
  }
  let url: string;
  try {
    const settings = migrateSettingsFromEnv(options.env);
    for (const warning of migrateStartWarnings(settings)) {
      stderr.write(`db:grant-runtime: ${warning.code}: ${warning.reason}\n`);
    }
    applyStoreTls(settings.storeTls);
    url = settings.url;
  } catch (error) {
    if (error instanceof ConfigError) {
      stderr.write(`db:grant-runtime: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const opened = await options.connect(url);
  const { connection } = opened;
  try {
    const granted = await grantRuntimeRole(connection, role);
    stdout.write(
      `db:grant-runtime: granted ${role} ${String(granted.tables)} tables and views ` +
        `(${String(granted.appendOnlyTables)} append-only: SELECT and INSERT only), ` +
        `${String(granted.sequences)} sequences, MAINTAIN on ${String(granted.maintainTables)} ` +
        `tables, EXECUTE on ${String(granted.functions)} functions, and the default privileges ` +
        'for later tables and sequences; never CREATE.\n',
    );
    return 0;
  } catch (error) {
    if (error instanceof RuntimeRoleError) {
      stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    await opened.close();
  }
}
