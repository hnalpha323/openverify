/**
 * C268.3 (Workflow 11D load-harness), against a real Postgres 17: seed:load refuses any database not
 * named `openverify_load` (whatever the URL said), and at the small scale its steps write the
 * organisations, the principals (keys and TOTP-enrolled users), accounts, inquiries in their
 * statuses, keyed lists, keyed transactions and the connection, each recorded in the mode-0600
 * record; a repeated step is skipped and `verify` agrees with the database. The watchlist step
 * (a 100,000-name sync) runs in the harness's smoke run, not here. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDatabase,
  createKeyring,
  runMigrations,
  setDefaultKeyring,
  type Db,
} from '@openverify/db';
import { createIntegrationPool, startIntegrationPostgres } from '@openverify/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock, ulidIdGenerator } from '../ports.js';
import {
  LOAD_DATABASE,
  LoadSeedRefusedError,
  loadSeedSettingsFromEnv,
  parseLoadSeedArgs,
  runLoadSeed,
  type LoadSeedSettings,
} from './load-seed.js';
import { nodeFiles } from './load/files.test-support.js';
import { readRecord } from './load/record.js';

let container: Awaited<ReturnType<typeof startIntegrationPostgres>>;
let pool: Pool;
let db: Db;
let settings: LoadSeedSettings;
let directory: string;

async function createNamedDatabase(name: string): Promise<string> {
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

beforeAll(async () => {
  container = await startIntegrationPostgres();
  const url = await createNamedDatabase(LOAD_DATABASE);
  pool = createIntegrationPool(url, { max: 4 });
  db = createDatabase(pool);
  await runMigrations(db);
  const kek = randomBytes(32);
  setDefaultKeyring(createKeyring(kek));
  settings = loadSeedSettingsFromEnv({
    OPENVERIFY_MODE: 'development',
    DATABASE_URL: url,
    OPENVERIFY_API_KEY_PEPPER: 'synthetic-pepper-of-at-least-thirty-two-chars',
    OPENVERIFY_BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
    OPENVERIFY_KEK: kek.toString('base64'),
  });
  directory = await mkdtemp(join('/tmp', 'openverify-load-seed-it-'));
});

afterAll(async () => {
  await pool.end();
  await container.stop();
  await rm(directory, { recursive: true, force: true });
});

/** A raw statement's rows (drizzle types `execute` loosely). */
const query = async (statement: SQL): Promise<{ rows: Record<string, unknown>[] }> => {
  const result: unknown = await db.execute(statement);
  return result as { rows: Record<string, unknown>[] };
};

const run = (step: string, options: { database?: Db; pool?: Pool } = {}) =>
  runLoadSeed({
    db: options.database ?? db,
    pool: options.pool ?? pool,
    settings,
    args: parseLoadSeedArgs([
      '--scale',
      'small',
      '--step',
      step,
      '--secrets-file',
      join(directory, 'seed.json'),
    ]),
    files: nodeFiles,
    ids: ulidIdGenerator,
    clock: systemClock,
    repositoryRoot: process.cwd(),
    out: () => undefined,
  });

describe('seed:load refuses another database (C268.3)', () => {
  it('refuses a connection whose current database is not openverify_load, before any write', async () => {
    const otherUrl = await createNamedDatabase('openverify_other');
    const otherPool = createIntegrationPool(otherUrl, { max: 1 });
    try {
      await expect(
        run('organisations', { database: createDatabase(otherPool), pool: otherPool }),
      ).rejects.toThrow(LoadSeedRefusedError);
      const tables = await otherPool.query(
        "select count(*)::int as n from pg_tables where schemaname = 'public'",
      );
      expect(tables.rows[0]).toEqual({ n: 0 });
    } finally {
      await otherPool.end();
    }
  });

  it('refuses a URL that names another database before connecting', () => {
    expect(() =>
      loadSeedSettingsFromEnv({
        OPENVERIFY_MODE: 'development',
        DATABASE_URL: 'postgres://u:p@127.0.0.1:1/openverify',
        OPENVERIFY_API_KEY_PEPPER: 'synthetic-pepper-of-at-least-thirty-two-chars',
        OPENVERIFY_BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
        OPENVERIFY_KEK: randomBytes(32).toString('base64'),
      }),
    ).toThrow(LoadSeedRefusedError);
  });
});

describe('seed:load at the small scale (C268.3)', () => {
  it('creates the 18 organisations and their 36 environments, with the shipped require-mfa', async () => {
    const result = await run('organisations');
    expect(result.result.counts).toEqual({ organisations: 18, environments: 36 });
    const record = await readRecord(nodeFiles, join(directory, 'seed.json'));
    expect(Object.keys(record?.environments ?? {})).toHaveLength(36);
    expect(record?.refs['template:load-a']).toMatch(/^itmpl_/u);
    expect(record?.refs['graph-template:load-s01 production']).toMatch(/^grqt_/u);
    expect(record?.refs['transaction-type:load-b']).toMatch(/^txntp_/u);
    expect(record?.refs['import-list:names:load-s13 sandbox']).toMatch(/^lst_/u);
    expect(record?.refs['watchlist-template:load-s01 sandbox']).toMatch(/^rptp_/u);
    const organisations = await query(
      sql`select count(*)::int as n, count(*) filter (where require_mfa)::int as mfa from organizations`,
    );
    expect(organisations.rows[0]).toEqual({ n: 18, mfa: 18 });
    expect((await stat(join(directory, 'seed.json'))).mode & 0o777).toBe(0o600);
    expect((await run('organisations')).skipped).toBe(true);
  });

  it('creates every key pool and the TOTP-enrolled users, secrets in the record only', async () => {
    const result = await run('principals');
    expect(result.result.counts).toEqual({ keys: 32, users: 40 });
    const record = await readRecord(nodeFiles, join(directory, 'seed.json'));
    expect(record?.keys['api-reads']).toHaveLength(2);
    expect(record?.keys.graph?.map((key) => key.environment)).toEqual([
      'load-s01 sandbox',
      'load-s01 production',
    ]);
    expect(record?.users).toHaveLength(40);
    expect(
      record?.users.every(
        (user) => user.email.endsWith('@example.com') && user.address.startsWith('2001:db8:4c00::'),
      ),
    ).toBe(true);
    const factors = await query(
      sql`select count(*)::int as n from mfa_factors where confirmed_at is not null`,
    );
    expect(factors.rows[0]?.n).toBe(40);
    const keys = await query(sql`select count(*)::int as n from api_keys`);
    expect(keys.rows[0]?.n).toBe(32);
  });

  it('creates the accounts, then the inquiries in their statuses', async () => {
    await run('accounts');
    const result = await run('inquiries');
    expect(result.result.counts).toMatchObject({
      'settled-inquiries': 500,
      'review-inquiries': 600,
      'write-inquiries': 100,
      'flow-inquiries': 400,
      'verification-inquiries': 60,
      'connect-source-inquiries': 2,
    });
    const statuses = await query(
      sql`select status, count(*)::int as n from inquiries group by status order by status`,
    );
    expect(Object.fromEntries(statuses.rows.map((row) => [row.status, row.n]))).toMatchObject({
      needs_review: 600,
      created: 560,
    });
  });

  it('writes the keyed lists, the keyed transactions and the connection, then verifies', async () => {
    const lists = await run('lists');
    expect(lists.result.counts).toMatchObject({
      'email-address:load-a': 100,
      'name:load-b': 1000,
      'country:load-a': 2,
    });
    const transactions = await run('transactions');
    expect(transactions.result.counts).toEqual({ transactions: 2000 });
    const keys = await query(sql`select count(*)::int as n from transaction_field_keys`);
    expect(keys.rows[0]?.n).toBe(6000);
    await run('connect');
    const connection = await query(sql`select status from connect_connections`);
    expect(connection.rows).toEqual([{ status: 'active' }]);
    await run('graph');
    const verified = await run('verify');
    expect(verified.result.counts).toMatchObject({ users: 40, organisations: 18 });
    const record = await readRecord(nodeFiles, join(directory, 'seed.json'));
    expect(record?.done).toEqual([
      'organisations',
      'principals',
      'accounts',
      'inquiries',
      'lists',
      'transactions',
      'connect',
      'graph',
      'verify',
    ]);
  });
});
