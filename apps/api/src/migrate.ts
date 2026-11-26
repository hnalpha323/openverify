/**
 * Brings a database to the current schema: pending migrations, then the data steps a schema
 * change cannot do in SQL. Safe to run on every deploy (`db:migrate`, also run by `seed:dev`).
 *
 * Schema v2 (migration 0003) adds `events.object_id`, which only the encrypted payload knows
 * for events written before it. They get it here, in batches, so `GET /events?filter[object-id]`
 * and C16 redaction find them; this needs `OPENVERIFY_KEK` (or the previous KEK that sealed
 * them) when such events exist. Once done, the step finds nothing and costs one query.
 *
 * C249.3, C249.4 (Phase 11, Workflow 11B, platform-ops): `db:migrate` connects as the migration
 * role (`OPENVERIFY_MIGRATION_DATABASE_URL`, else `DATABASE_URL` with a production warning) and
 * holds the session advisory lock `MIGRATE_LOCK.key` around the migrations and the backfill, so two
 * runs at once serialise and the second finds nothing to do; a wait past
 * `OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS` exits 75 with `migrate_lock_timeout`.
 */
import { MIGRATE_LOCK } from '@openverify/contracts';
import {
  appliedMigrationCount,
  backfillEventObjectIds,
  createDatabase,
  keyringFromEnv,
  MigrateLockTimeoutError,
  setDefaultKeyring,
  runMigrations,
  withMigrateLock,
  type Db,
  type MigrateLockConnection,
} from '@openverify/db';
import { Client, Pool } from 'pg';
import { ConfigError, loadMigrateConfig, type AppMode } from './config.js';
import { CONFIG_REGISTRY } from './config-registry.js';
import { resolveSecretFiles } from './config/secret-files.js';
import { logStartupWarnings, type StartupWarning } from './config/startup-warnings.js';
import { applyStoreTls, type StoreTlsSettings } from './config/store-tls.js';
import type { WorkerLogger } from './jobs/logger.js';

export const DEFAULT_MIGRATE_BATCH_SIZE = 500;

export interface MigrateOptions {
  db: Db;
  /** Prints one line per step; counts only. */
  out: (line: string) => void;
  /** Events per backfill batch; defaults to 500. */
  batchSize?: number;
  /** C249.4: the lock's own connection and its wait; omitted, nothing is locked (tests, PGlite). */
  lock?: { connection: MigrateLockConnection; timeoutSeconds: number } | undefined;
}

export interface MigrateResult {
  /** Migrations this run applied (0 when another run, or an earlier one, applied them). */
  migrationsApplied: number;
  /** Events written before schema v2 that got their object id in this run. */
  eventsBackfilled: number;
}

export async function migrateDatabase(options: MigrateOptions): Promise<MigrateResult> {
  const { db, out, lock } = options;
  const work = async (): Promise<MigrateResult> => {
    const before = await appliedMigrationCount(db);
    await runMigrations(db);
    const migrationsApplied = (await appliedMigrationCount(db)) - before;
    out('db:migrate: migrations applied');
    let eventsBackfilled = 0;
    let after: string | null = null;
    do {
      const batch = await backfillEventObjectIds(db, {
        after,
        limit: options.batchSize ?? DEFAULT_MIGRATE_BATCH_SIZE,
      });
      eventsBackfilled += batch.updated;
      after = batch.next;
    } while (after !== null);
    out(
      eventsBackfilled === 0
        ? 'db:migrate: every event has its object id'
        : `db:migrate: gave ${String(eventsBackfilled)} events written before schema v2 their object id`,
    );
    return { migrationsApplied, eventsBackfilled };
  };
  return lock === undefined ? work() : withMigrateLock(lock.connection, lock.timeoutSeconds, work);
}

/** The variable `db:migrate`'s connection came from. */
export type MigrateUrlSource = 'OPENVERIFY_MIGRATION_DATABASE_URL' | 'DATABASE_URL';

/** C249.3, C249.4: what `db:migrate` reads from its environment. */
export interface MigrateSettings {
  url: string;
  source: MigrateUrlSource;
  lockTimeoutSeconds: number;
  mode: AppMode;
  /** C249.1: the CA files to apply before connecting. */
  storeTls: StoreTlsSettings;
  /** C249.1, C249.2: the configuration's own warnings (transport, secret files). */
  startupWarnings: readonly StartupWarning[];
}

/**
 * Reads `db:migrate`'s settings through `loadMigrateConfig` (foundation-11b's, over the
 * secret-files and store-tls hooks): the migration role's URL (`OPENVERIFY_MIGRATION_DATABASE_URL`
 * or its `_FILE` form), else `DATABASE_URL`; the lock's wait; the mode; the stores' TLS.
 * @throws {ConfigError} naming each invalid variable, never its value.
 */
export function migrateSettingsFromEnv(env: NodeJS.ProcessEnv): MigrateSettings {
  const config = loadMigrateConfig(env);
  return {
    url: config.migrationDatabaseUrl ?? config.databaseUrl,
    source:
      config.migrationDatabaseUrl === null ? 'DATABASE_URL' : 'OPENVERIFY_MIGRATION_DATABASE_URL',
    lockTimeoutSeconds: config.lockTimeoutSeconds,
    mode: config.mode,
    storeTls: config.storeTls,
    startupWarnings: config.startupWarnings,
  };
}

/** A warning `db:migrate` logs at start: a stable code and an operator's sentence, no value. */
export type MigrateStartWarning = StartupWarning;

/** C249.1 to C249.3: what `db:migrate` warns about at start: the configuration's, then its own. */
export function migrateStartWarnings(settings: MigrateSettings): MigrateStartWarning[] {
  const own: MigrateStartWarning[] =
    settings.mode === 'production' && settings.source === 'DATABASE_URL'
      ? [
          {
            code: 'migration_url_unset',
            variable: 'OPENVERIFY_MIGRATION_DATABASE_URL',
            reason:
              'db:migrate connects with DATABASE_URL, the runtime role; set OPENVERIFY_MIGRATION_DATABASE_URL ' +
              'to the migration role and grant the runtime role with db:grant-runtime',
          },
        ]
      : [];
  return [...settings.startupWarnings, ...own];
}

/** Where `db:migrate` writes: its step lines and its structured warnings and refusals. */
export interface MigrateCommandIo {
  out: (line: string) => void;
  logger: Pick<WorkerLogger, 'warn' | 'error'>;
}

/**
 * `pnpm --filter @openverify/api db:migrate`: reads its settings, logs its start warnings, connects
 * and migrates under the lock.
 * @returns the process's exit code: 0, `MIGRATE_LOCK.exitCode` (75) on `migrate_lock_timeout`, or 1.
 */
export async function runMigrateCommand(
  env: NodeJS.ProcessEnv,
  io: MigrateCommandIo,
): Promise<number> {
  try {
    const settings = migrateSettingsFromEnv(env);
    logStartupWarnings(io.logger, migrateStartWarnings(settings));
    applyStoreTls(settings.storeTls);
    // Phase 11, Workflow 11C (plan amendment 14): the backfill opens sealed event payloads with the
    // process keyring, which reads OPENVERIFY_KEK only; with the KEK given as a file (the chart's
    // form) it is installed from the resolved environment for this run. A KEK in the environment
    // keeps its lazy reading, so a run with nothing to backfill never parses it, as before.
    const kekGiven = (env.OPENVERIFY_KEK_FILE?.trim() ?? '') !== '';
    if (kekGiven) {
      setDefaultKeyring(keyringFromEnv(resolveSecretFiles(env, CONFIG_REGISTRY).env));
    }
    const pool = new Pool({ connectionString: settings.url });
    const lock = new Client({ connectionString: settings.url });
    let connected = false;
    try {
      await lock.connect();
      connected = true;
      await migrateDatabase({
        db: createDatabase(pool),
        out: io.out,
        lock: { connection: lock, timeoutSeconds: settings.lockTimeoutSeconds },
      });
    } finally {
      if (connected) {
        await lock.end();
      }
      await pool.end();
      if (kekGiven) {
        setDefaultKeyring(undefined);
      }
    }
    return 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      io.logger.error({ code: 'config_invalid', issues: [...error.issues] }, error.message);
      return 1;
    }
    if (error instanceof MigrateLockTimeoutError) {
      io.logger.error({ code: error.code, timeoutSeconds: error.timeoutSeconds }, error.message);
      return MIGRATE_LOCK.exitCode;
    }
    io.logger.error({ error: (error as Error).name }, (error as Error).message);
    return 1;
  }
}

/**
 * C249.3: the environment a migration-role command (`seed:dev`, `kek:rewrap`) reads, with each
 * secret's `<NAME>_FILE` resolved (C249.2) and `DATABASE_URL` taken from
 * `OPENVERIFY_MIGRATION_DATABASE_URL` when that is set.
 * @throws {ConfigError} for a secret file it cannot use, naming the variable.
 */
export function migrationRoleEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Phase 11, Workflow 11C (plan amendment 14): every secret's <NAME>_FILE form first (C249.2).
  const files = resolveSecretFiles(env, CONFIG_REGISTRY);
  if (files.issues.length > 0) {
    throw new ConfigError(files.issues);
  }
  const resolved = files.env;
  const migration = resolved.OPENVERIFY_MIGRATION_DATABASE_URL?.trim() ?? '';
  return migration === '' ? resolved : { ...resolved, DATABASE_URL: migration };
}
