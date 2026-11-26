/**
 * Upgrading a Postgres 17 database that holds Phase 1 rows to schema v2 (migration 0003),
 * the same scenario as `migration-v2.test.ts` on the production server image.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import { getInquiry } from './repositories/inquiries.js';
import { createIntegrationPool, startIntegrationPostgres } from './testing.js';
import { expectV2Upgrade, seedV1, type Exec, type V1Seed } from './v1-fixtures.test-support.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let seed: V1Seed;
const exec: Exec = async (text, params) => {
  if (!pool) throw new Error('no pool');
  return pool.query(text, params);
};

beforeAll(async () => {
  setDefaultKeyring(keyring);
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri());
  db = createDatabase(pool);
  await runMigrations(db, { upTo: '0002_files_unique_kind' });
  seed = await seedV1(exec, keyring);
  await runMigrations(db);
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await pool?.end();
  await container?.stop();
});

describe('migration 0003 on Postgres 17 with Phase 1 rows', () => {
  it('applies on top of 0000-0002', async () => {
    const applied = await exec('select count(*)::int as count from drizzle.__drizzle_migrations');

    expect(applied.rows).toEqual([{ count: migrationTags().length }]);
  });

  it('backfills accounts, statuses, ids, roles and defaults', async () => {
    await expectV2Upgrade(exec, seed, expect);
  });

  it('keeps the v1 ciphertexts readable through the v2 repositories', async () => {
    const inquiry = await getInquiry(db, seed.environments.e1, seed.inquiries.i2);

    expect(inquiry?.fields).toEqual({ 'name-first': 'Synthetic i2' });
  });
});
