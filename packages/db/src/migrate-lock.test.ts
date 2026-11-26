/**
 * C249.4 (Phase 11, Workflow 11B, platform-ops): the migrate lock. `db:migrate` holds the session
 * advisory lock whose key derives from `openverify:migrate` around its work, on one dedicated
 * connection, waiting at most its timeout (`lock_timeout`, which Postgres applies to an advisory
 * lock's wait) and then failing with `migrate_lock_timeout`. Two runs at once are proved against a
 * real Postgres in `apps/api/src/migrate.integration.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appliedMigrationCount,
  MIGRATE_LOCK_LABEL,
  MIGRATIONS_FOLDER,
  MigrateLockTimeoutError,
  migrateLockKey,
  withMigrateLock,
  type MigrateLockConnection,
} from './migrate.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

/** A connection that records each statement and answers as `answer` says. */
function recordingConnection(
  answer: (text: string) => Promise<unknown> = () => Promise.resolve({ rows: [] }),
) {
  const calls: { text: string; values: unknown[] | undefined }[] = [];
  const connection: MigrateLockConnection = {
    query: (text, values) => {
      calls.push({ text, values });
      return answer(text);
    },
  };
  return { connection, calls };
}

const KEY = '1480802125763551134';

describe('the migrate lock’s key (C249.4)', () => {
  it('is the first eight bytes of the SHA-256 of openverify:migrate, as a signed bigint', () => {
    expect(MIGRATE_LOCK_LABEL).toBe('openverify:migrate');
    expect(migrateLockKey()).toBe(KEY);
    expect(migrateLockKey('another label')).not.toBe(KEY);
  });
});

describe('withMigrateLock (C249.4)', () => {
  it('bounds the wait, takes the lock, runs the work, then releases the lock', async () => {
    const { connection, calls } = recordingConnection();
    const order: string[] = [];

    const result = await withMigrateLock(connection, 7, () => {
      order.push(`work after ${String(calls.length)} statements`);
      return Promise.resolve('done');
    });

    expect(result).toBe('done');
    expect(calls).toEqual([
      { text: "select set_config('lock_timeout', $1, false)", values: ['7000ms'] },
      { text: 'select pg_advisory_lock($1::bigint)', values: [KEY] },
      { text: "select set_config('lock_timeout', '0', false)", values: undefined },
      { text: 'select pg_advisory_unlock($1::bigint)', values: [KEY] },
    ]);
    expect(order).toEqual(['work after 3 statements']);
  });

  it('fails with migrate_lock_timeout when the wait runs out, running nothing', async () => {
    const lockNotAvailable = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    });
    const { connection, calls } = recordingConnection((text) =>
      text.includes('pg_advisory_lock') ? Promise.reject(lockNotAvailable) : Promise.resolve({}),
    );
    let ran = false;

    const refusal = await withMigrateLock(connection, 2, () => {
      ran = true;
      return Promise.resolve();
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(MigrateLockTimeoutError);
    expect(refusal).toMatchObject({ code: 'migrate_lock_timeout', timeoutSeconds: 2 });
    expect(ran).toBe(false);
    expect(calls.map((call) => call.text)).not.toContain('select pg_advisory_unlock($1::bigint)');
    expect(calls.at(-1)?.text).toBe("select set_config('lock_timeout', '0', false)");
  });

  it('passes any other failure of the lock through unchanged', async () => {
    const broken = Object.assign(new Error('connection terminated'), { code: '57P01' });
    const { connection } = recordingConnection((text) =>
      text.includes('pg_advisory_lock') ? Promise.reject(broken) : Promise.resolve({}),
    );

    await expect(withMigrateLock(connection, 2, () => Promise.resolve())).rejects.toBe(broken);
  });

  it('releases the lock when the work fails', async () => {
    const { connection, calls } = recordingConnection();
    const failure = new Error('a migration failed');

    await expect(withMigrateLock(connection, 1, () => Promise.reject(failure))).rejects.toBe(
      failure,
    );

    expect(calls.at(-1)).toEqual({ text: 'select pg_advisory_unlock($1::bigint)', values: [KEY] });
  });
});

describe('on Postgres (PGlite)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it('takes and releases a real advisory lock', async () => {
    const held = (): Promise<number> =>
      database.client
        .query<{ n: number }>(
          "select count(*)::int as n from pg_locks where locktype = 'advisory' and granted",
        )
        .then((result) => result.rows[0]?.n ?? -1);

    const during = await withMigrateLock(database.client, 1, held);

    expect(during).toBe(1);
    expect(await held()).toBe(0);
  });

  it('counts the migrations the database records as applied', async () => {
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };

    expect(await appliedMigrationCount(database.db)).toBe(journal.entries.length);
  });
});
