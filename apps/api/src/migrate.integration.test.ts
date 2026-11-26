/**
 * C249.4 (Phase 11, Workflow 11B, platform-ops), against a real Postgres 17: two `db:migrate` runs
 * started at once on an empty database serialise on the migrate lock, so one applies every
 * migration and the other waits and then finds nothing to do; a run that cannot take the lock
 * within `OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS` exits 75 with `migrate_lock_timeout`, having
 * migrated nothing. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATE_LOCK, newId } from '@openverify/contracts';
import {
  appliedMigrationCount,
  createDatabase,
  createEnvironment,
  createEvent,
  createOrganization,
  events,
  keyringFromEnv,
  migrationTags,
  setDefaultKeyring,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { startIntegrationPostgres } from '@openverify/db/testing';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase, runMigrateCommand } from './migrate.js';

let container: Awaited<ReturnType<typeof startIntegrationPostgres>>;

beforeAll(async () => {
  container = await startIntegrationPostgres();
});

afterAll(async () => {
  await container.stop();
});

/** A database of its own on the container, never migrated. */
async function freshDatabase(name: string): Promise<string> {
  const admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  return url.toString();
}

/** One `db:migrate` as the script runs it: a pool for the work, a client for the lock. */
async function oneRun(url: string) {
  const pool = new Pool({ connectionString: url, max: 2 });
  const lock = new Client({ connectionString: url });
  await lock.connect();
  try {
    return await migrateDatabase({
      db: createDatabase(pool),
      out: () => undefined,
      lock: { connection: lock, timeoutSeconds: 60 },
    });
  } finally {
    await lock.end();
    await pool.end();
  }
}

describe('db:migrate under the migrate lock (C249.4)', () => {
  it('serialises two runs started at once: the second finds nothing to do', async () => {
    const url = await freshDatabase('migrate_twice');

    const results = await Promise.all([oneRun(url), oneRun(url)]);

    const applied = results.map((result) => result.migrationsApplied).sort((a, b) => a - b);
    expect(applied).toEqual([0, migrationTags().length]);
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      expect(await appliedMigrationCount(createDatabase(pool))).toBe(migrationTags().length);
    } finally {
      await pool.end();
    }
  });

  it('exits 75 with migrate_lock_timeout while another run holds the lock, migrating nothing', async () => {
    const url = await freshDatabase('migrate_locked');
    const holder = new Client({ connectionString: url });
    await holder.connect();
    await holder.query('select pg_advisory_lock($1::bigint)', [MIGRATE_LOCK.key]);
    const logged: { level: string; object: Record<string, unknown>; message: string }[] = [];
    const logger = {
      warn: (object: Record<string, unknown>, message: string) =>
        logged.push({ level: 'warn', object, message }),
      error: (object: Record<string, unknown>, message: string) =>
        logged.push({ level: 'error', object, message }),
    };

    try {
      const code = await runMigrateCommand(
        { DATABASE_URL: url, OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: '1', NODE_ENV: 'test' },
        { out: () => undefined, logger },
      );

      expect(code).toBe(MIGRATE_LOCK.exitCode);
      expect(logged).toEqual([
        {
          level: 'error',
          object: { code: 'migrate_lock_timeout', timeoutSeconds: 1 },
          message:
            'db:migrate: migrate_lock_timeout: another db:migrate held the lock for 1 s; run it again',
        },
      ]);
      const pool = new Pool({ connectionString: url, max: 1 });
      try {
        expect(await appliedMigrationCount(createDatabase(pool))).toBe(0);
      } finally {
        await pool.end();
      }
    } finally {
      await holder.end();
    }
  });

  it('migrates through the command once the lock is free, and says so', async () => {
    const url = await freshDatabase('migrate_command');
    const lines: string[] = [];

    const code = await runMigrateCommand(
      { DATABASE_URL: url, NODE_ENV: 'test' },
      {
        out: (line) => lines.push(line),
        logger: { warn: () => undefined, error: () => undefined },
      },
    );

    expect(code).toBe(0);
    expect(lines).toEqual([
      'db:migrate: migrations applied',
      'db:migrate: every event has its object id',
    ]);
  });
});

describe("db:migrate's backfill with the KEK given as a file (Phase 11, Workflow 11C; plan amendment 14)", () => {
  it('opens the sealed payloads of events written before schema v2 with OPENVERIFY_KEK_FILE alone', async () => {
    const url = await freshDatabase('migrate_kek_file');
    const kek = randomBytes(32).toString('base64');
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = createDatabase(pool);
    const dir = mkdtempSync(join(tmpdir(), 'openverify-migrate-kek-'));
    const kekFile = join(dir, 'OPENVERIFY_KEK');
    writeFileSync(kekFile, `${kek}\n`, { mode: 0o440 });
    try {
      await oneRun(url);
      // An event as Phase 1 wrote it, sealed under the KEK: the row has no object yet.
      setDefaultKeyring(keyringFromEnv({ OPENVERIFY_KEK: kek }));
      const organization = await createOrganization(db, {
        id: newId('org'),
        name: 'Backfill Example',
      });
      const environment = await createEnvironment(db, {
        id: newId('env'),
        organizationId: organization.id,
        kind: 'sandbox',
      });
      const eventId = newId('evt');
      const inquiryId = newId('inq');
      await createEvent(db, environment.id, {
        id: eventId,
        name: 'inquiry.created',
        payload: { data: { type: 'inquiry', id: inquiryId, attributes: { status: 'created' } } },
      });
      await db
        .update(events)
        .set({ objectId: null, objectType: null })
        .where(eq(events.id, eventId));
      setDefaultKeyring(undefined);

      const lines: string[] = [];
      const code = await runMigrateCommand(
        { DATABASE_URL: url, OPENVERIFY_KEK_FILE: kekFile, NODE_ENV: 'test' },
        {
          out: (line) => lines.push(line),
          logger: { warn: () => undefined, error: () => undefined },
        },
      );

      expect(code).toBe(0);
      expect(lines).toContain('db:migrate: gave 1 events written before schema v2 their object id');
      const [row] = await db
        .select({ objectId: events.objectId })
        .from(events)
        .where(eq(events.id, eventId));
      expect(row?.objectId).toBe(inquiryId);
    } finally {
      setDefaultKeyring(undefined);
      await pool.end();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
