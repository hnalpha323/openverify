/**
 * C236.3, C241.3 (Workflow 11A, `api-consent`) on Postgres 17 (Testcontainers): a `flow` text is
 * stored once per environment and digest under concurrency, and the retention pass never deletes a
 * text a session is citing. Both orders of each race:
 *
 * - two sessions accepting the same text at once: the second insert waits on the first's uncommitted
 *   key, then finds the row and keeps it; one row, whichever commits first;
 * - a retention pass and a session reusing an old, uncited text: the session's `FOR KEY SHARE` makes
 *   the pass skip the row (`SKIP LOCKED`), and a pass that took the row first deletes it before the
 *   session's insert, which then writes it again.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database, type Db } from '../client.js';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { runMigrations } from '../migrate.js';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '../testing.js';
import {
  deleteUncitedConsentTexts,
  getConsentText,
  insertConsentTextIfAbsent,
} from './consent-texts.js';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 6 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(createKeyring(randomBytes(32)));
  environmentId = (await createTestTenant(db)).environment.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const DAY = 86_400_000;
let digests = 0;
const digest = () => (digests += 1).toString(16).padStart(64, '0');

const count = async (sha256: string) =>
  (
    await pool.query<{ n: number }>(
      'select count(*)::int as n from consent_texts where environment_id = $1 and sha256 = $2',
      [environmentId, sha256],
    )
  ).rows[0]?.n;

/** A transaction held open until `release` resolves, running `work` first. */
function held<T>(work: (tx: Db) => Promise<T>, outcome: 'commit' | 'rollback' = 'commit') {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: (value: T) => void;
  const done = new Promise<T>((resolve) => {
    ready = resolve;
  });
  const committed = db.transaction(async (tx) => {
    const value = await work(tx);
    ready(value);
    await gate;
    if (outcome === 'rollback') {
      throw new Error('synthetic rollback');
    }
    return value;
  });
  return { done, release, committed };
}

const waitFor = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('two sessions accepting the same text at once (C236.3)', () => {
  for (const outcome of ['commit', 'rollback'] as const) {
    it(`keeps one row when the first session's transaction ends in a ${outcome}`, async () => {
      const sha256 = digest();
      const text = { sha256, locale: 'en', body: 'Synthetic share text.' };
      const first = held((tx) => insertConsentTextIfAbsent(tx, environmentId, text), outcome);
      await first.done;
      // The second waits on the first's uncommitted key, then finds its row or writes its own.
      const second = db.transaction((tx) => insertConsentTextIfAbsent(tx, environmentId, text));
      await waitFor(200);
      first.release();
      await first.committed.catch(() => undefined);
      await second;
      expect(await count(sha256)).toBe(1);
      expect((await getConsentText(db, environmentId, sha256))?.body).toBe(text.body);
    });
  }
});

describe('the retention pass and a session reusing an old text (C241.3)', () => {
  it('skips a text a session holds, and the session keeps it', async () => {
    const sha256 = digest();
    const old = new Date(Date.now() - 3 * DAY);
    await insertConsentTextIfAbsent(db, environmentId, {
      sha256,
      locale: 'en',
      body: 'Synthetic old text.',
      createdAt: old,
    });
    const session = held((tx) =>
      insertConsentTextIfAbsent(tx, environmentId, { sha256, locale: 'en', body: 'ignored' }),
    );
    await session.done;
    expect(await deleteUncitedConsentTexts(db, 100, new Date(Date.now() - DAY))).toBe(0);
    session.release();
    await session.committed;
    expect(await count(sha256)).toBe(1);
  });

  it('writes the text again when a pass deleted it first', async () => {
    const sha256 = digest();
    await insertConsentTextIfAbsent(db, environmentId, {
      sha256,
      locale: 'en',
      body: 'Synthetic old text.',
      createdAt: new Date(Date.now() - 3 * DAY),
    });
    expect(await deleteUncitedConsentTexts(db, 100, new Date(Date.now() - DAY))).toBeGreaterThan(0);
    expect(await count(sha256)).toBe(0);
    await insertConsentTextIfAbsent(db, environmentId, {
      sha256,
      locale: 'en',
      body: 'Synthetic text again.',
    });
    expect(await count(sha256)).toBe(1);
    expect((await getConsentText(db, environmentId, sha256))?.body).toBe('Synthetic text again.');
  });
});
