/**
 * `migrateDatabase` (`pnpm --filter @openverify/api db:migrate`, also run by `seed:dev`):
 * pending migrations, then the data step schema v2 needs on databases upgraded from Phase 1:
 * events written before v2 get their `object_id`, so `filter[object-id]` and C16 redaction find
 * them. Every value is synthetic.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATE_LOCK, newId } from '@openverify/contracts';
import { createEvent, events, migrateLockKey, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from './config.js';
import {
  migrateDatabase,
  migrateSettingsFromEnv,
  migrateStartWarnings,
  migrationRoleEnv,
} from './migrate.js';

let database: TestDatabase;
let db: Db;
let lines: string[];
const out = (line: string) => {
  lines.push(line);
};

beforeEach(async () => {
  database = await createTestDatabase();
  db = database.db;
  lines = [];
});

afterEach(async () => {
  await database.close();
});

/** An event as Phase 1 stored it: the payload names the inquiry, the row has no object. */
async function phase1Event(environmentId: string, inquiryId: string): Promise<string> {
  const id = newId('evt');
  await createEvent(db, environmentId, {
    id,
    name: 'inquiry.created',
    payload: { data: { type: 'inquiry', id: inquiryId, attributes: { status: 'created' } } },
  });
  await db.update(events).set({ objectId: null, objectType: null }).where(eq(events.id, id));
  return id;
}

async function objectOf(id: string) {
  const [row] = await db
    .select({ objectId: events.objectId, objectType: events.objectType })
    .from(events)
    .where(eq(events.id, id));
  return row;
}

describe('migrateDatabase', () => {
  it('gives events written before schema v2 their object, in batches, so redaction finds them', async () => {
    const { environment } = await createTestTenant(db);
    const { inquiry } = await createTestInquiry(db, environment.id);
    const ids = [
      await phase1Event(environment.id, inquiry.id),
      await phase1Event(environment.id, inquiry.id),
      await phase1Event(environment.id, inquiry.id),
    ];

    const result = await migrateDatabase({ db, out, batchSize: 2 });

    expect(result).toEqual({ migrationsApplied: 0, eventsBackfilled: 3 });
    for (const id of ids) {
      expect(await objectOf(id)).toEqual({ objectId: inquiry.id, objectType: 'inquiry' });
    }
    expect(lines).toEqual([
      'db:migrate: migrations applied',
      'db:migrate: gave 3 events written before schema v2 their object id',
    ]);
  });

  it('is a no-op once done, as on a fresh database', async () => {
    const result = await migrateDatabase({ db, out });

    expect(result).toEqual({ migrationsApplied: 0, eventsBackfilled: 0 });
    expect(lines).toEqual([
      'db:migrate: migrations applied',
      'db:migrate: every event has its object id',
    ]);
  });
});

describe('the migrate lock around the work (C249.4)', () => {
  it('derives MIGRATE_LOCK.key from its label', () => {
    expect(migrateLockKey(MIGRATE_LOCK.label)).toBe(MIGRATE_LOCK.key);
  });

  it('holds the lock on its own connection while it migrates and backfills, then releases it', async () => {
    const statements: string[] = [];
    const connection = {
      query: async (text: string, values?: unknown[]) => {
        statements.push(text);
        return database.client.query(text, values);
      },
    };

    const result = await migrateDatabase({ db, out, lock: { connection, timeoutSeconds: 5 } });

    expect(result).toEqual({ migrationsApplied: 0, eventsBackfilled: 0 });
    expect(statements).toContain('select pg_advisory_lock($1::bigint)');
    expect(statements.at(-1)).toBe('select pg_advisory_unlock($1::bigint)');
  });
});

describe('db:migrate’s settings (C249.3, C249.4), through loadMigrateConfig', () => {
  const database =
    'postgresql://runtime:change-me-synthetic@db.example.org:5432/openverify?sslmode=verify-full';
  const migration =
    'postgresql://migrator:change-me-synthetic@db.example.org:5432/openverify?sslmode=verify-full';
  const issuesOf = (env: NodeJS.ProcessEnv): readonly string[] => {
    try {
      migrateSettingsFromEnv(env);
    } catch (error) {
      if (error instanceof ConfigError) {
        return error.issues;
      }
      throw error;
    }
    return [];
  };

  it('connects as the migration role when OPENVERIFY_MIGRATION_DATABASE_URL is set', () => {
    expect(
      migrateSettingsFromEnv({
        DATABASE_URL: database,
        OPENVERIFY_MIGRATION_DATABASE_URL: migration,
        OPENVERIFY_MODE: 'production',
      }),
    ).toMatchObject({
      url: migration,
      source: 'OPENVERIFY_MIGRATION_DATABASE_URL',
      lockTimeoutSeconds: 600,
      mode: 'production',
      startupWarnings: [],
    });
  });

  it('reads the migration URL from its _FILE form (C249.2)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openverify-migrate-'));
    try {
      const file = join(directory, 'migration-url');
      writeFileSync(file, `${migration}\n`, { mode: 0o600 });

      const settings = migrateSettingsFromEnv({
        DATABASE_URL: database,
        OPENVERIFY_MIGRATION_DATABASE_URL_FILE: file,
        OPENVERIFY_MODE: 'production',
      });

      expect(settings).toMatchObject({
        url: migration,
        source: 'OPENVERIFY_MIGRATION_DATABASE_URL',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('falls back to DATABASE_URL, and warns in production mode only', () => {
    const production = migrateSettingsFromEnv({
      DATABASE_URL: database,
      OPENVERIFY_MODE: 'production',
    });
    const development = migrateSettingsFromEnv({ DATABASE_URL: database, NODE_ENV: 'development' });

    expect(production).toMatchObject({ url: database, source: 'DATABASE_URL', mode: 'production' });
    expect(development).toMatchObject({ source: 'DATABASE_URL', mode: 'development' });
    expect(migrateStartWarnings(production)).toEqual([
      {
        code: 'migration_url_unset',
        variable: 'OPENVERIFY_MIGRATION_DATABASE_URL',
        reason:
          'db:migrate connects with DATABASE_URL, the runtime role; set OPENVERIFY_MIGRATION_DATABASE_URL ' +
          'to the migration role and grant the runtime role with db:grant-runtime',
      },
    ]);
    expect(migrateStartWarnings(development)).toEqual([]);
  });

  it('warns about a plain-text Postgres in production, naming the store and never the URL (C249.1)', () => {
    const warnings = migrateStartWarnings(
      migrateSettingsFromEnv({
        DATABASE_URL: 'postgresql://runtime:change-me-synthetic@db.example.org:5432/openverify',
        OPENVERIFY_MIGRATION_DATABASE_URL:
          'postgresql://migrator:change-me-synthetic@db.example.org:5432/openverify',
        OPENVERIFY_MODE: 'production',
      }),
    );

    expect(warnings.map((warning) => [warning.code, warning.store])).toEqual([
      ['insecure_transport', 'postgres'],
    ]);
    expect(JSON.stringify(warnings)).not.toContain('example.org');
  });

  it('reads the lock timeout from 1 to 3,600 seconds', () => {
    const env = { DATABASE_URL: database, NODE_ENV: 'test' };
    expect(
      migrateSettingsFromEnv({ ...env, OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: '1' })
        .lockTimeoutSeconds,
    ).toBe(1);
    expect(
      migrateSettingsFromEnv({ ...env, OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: '3600' })
        .lockTimeoutSeconds,
    ).toBe(3600);
    for (const bad of ['0', '3601', '1.5', 'ten']) {
      expect(issuesOf({ ...env, OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: bad }), bad).toEqual([
        'OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: must be a whole number from 1 to 3600',
      ]);
    }
  });

  it('refuses a missing runtime URL and a non-postgres migration URL, never echoing a value', () => {
    const issues = issuesOf({
      OPENVERIFY_MIGRATION_DATABASE_URL: 'mysql://canary-synthetic@h/db',
      NODE_ENV: 'test',
    });

    expect(issues).toEqual([
      'DATABASE_URL: is required',
      'OPENVERIFY_MIGRATION_DATABASE_URL: must be a postgres:// URL',
    ]);
    expect(issues.join('\n')).not.toContain('canary');
  });

  it('refuses an unknown mode', () => {
    expect(issuesOf({ DATABASE_URL: database, OPENVERIFY_MODE: 'staging' })).toHaveLength(1);
  });
});

describe('the migration role’s other commands (C249.3)', () => {
  it('reads DATABASE_URL from OPENVERIFY_MIGRATION_DATABASE_URL when it is set', () => {
    const env = {
      DATABASE_URL: 'postgresql://runtime@db.example.org/openverify',
      OPENVERIFY_MIGRATION_DATABASE_URL: 'postgresql://migrator@db.example.org/openverify',
      OPENVERIFY_KEK: 'change-me-synthetic',
    };

    expect(migrationRoleEnv(env)).toEqual({
      ...env,
      DATABASE_URL: 'postgresql://migrator@db.example.org/openverify',
    });
    expect(env.DATABASE_URL).toBe('postgresql://runtime@db.example.org/openverify');
  });

  // Phase 11, Workflow 11C (plan amendment 14): seed:dev and kek:rewrap read their secrets from
  // <NAME>_FILE too (C249.2), as db:migrate does, so the chart's file form reaches them.
  it('reads the migration URL, the KEK and the pepper from their files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openverify-migration-role-'));
    try {
      const file = (name: string, text: string) => {
        writeFileSync(join(dir, name), `${text}\n`, { mode: 0o440 });
        return join(dir, name);
      };
      const env = migrationRoleEnv({
        DATABASE_URL: 'postgresql://runtime@db.example.org/openverify',
        OPENVERIFY_MIGRATION_DATABASE_URL_FILE: file(
          'url',
          'postgresql://migrator@db.example.org/openverify',
        ),
        OPENVERIFY_KEK_FILE: file('kek', 'synthetic-kek-value'),
        OPENVERIFY_API_KEY_PEPPER_FILE: file('pepper', 'synthetic-pepper-value'),
      });

      expect(env.DATABASE_URL).toBe('postgresql://migrator@db.example.org/openverify');
      expect(env.OPENVERIFY_KEK).toBe('synthetic-kek-value');
      expect(env.OPENVERIFY_API_KEY_PEPPER).toBe('synthetic-pepper-value');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a secret set both ways, naming the variable', () => {
    expect(() =>
      migrationRoleEnv({ OPENVERIFY_KEK: 'synthetic-a', OPENVERIFY_KEK_FILE: '/run/kek' }),
    ).toThrow(ConfigError);
  });

  it('keeps DATABASE_URL when the migration URL is unset or blank', () => {
    const env = { DATABASE_URL: 'postgresql://runtime@db.example.org/openverify' };

    expect(migrationRoleEnv(env)).toEqual(env);
    expect(migrationRoleEnv({ ...env, OPENVERIFY_MIGRATION_DATABASE_URL: ' ' }).DATABASE_URL).toBe(
      env.DATABASE_URL,
    );
  });
});
