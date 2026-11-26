/**
 * Upgrading a database that already holds Phase 1 rows to schema v2 (migration 0003), on
 * PGlite. `migration-v2.integration.test.ts` runs the same upgrade on Postgres 17.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { pgErrorCode } from './errors.js';
import { migrationTags, runMigrations } from './migrate.js';
import { getInquiry } from './repositories/inquiries.js';
import { createEnvironment } from './repositories/organizations.js';
import * as schema from './schema.js';
import { PGLITE_EXTENSIONS, testId } from './testing.js';
import { expectV2Upgrade, seedV1, type Exec, type V1Seed } from './v1-fixtures.test-support.js';

const keyring = createKeyring(randomBytes(32));
let client: PGlite;
let seed: V1Seed;
const db = () => drizzle({ client, schema });
const exec: Exec = (text, params) => client.query(text, params);

beforeAll(async () => {
  setDefaultKeyring(keyring);
  client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await runMigrations(db(), { upTo: '0002_files_unique_kind' });
  seed = await seedV1(exec, keyring);
  await runMigrations(db());
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await client.close();
});

describe('migration 0003: schema v1 -> v2 with existing rows', () => {
  it('applies on top of 0000-0002', async () => {
    const applied = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );

    expect(applied.rows[0]?.count).toBe(migrationTags().length);
  });

  it('backfills accounts, statuses, ids, roles and defaults', async () => {
    await expectV2Upgrade(exec, seed, expect);
  });

  it('keeps the v1 ciphertexts readable through the v2 repositories', async () => {
    const inquiry = await getInquiry(db(), seed.environments.e1, seed.inquiries.i1);

    expect(inquiry?.fields).toEqual({ 'name-first': 'Synthetic i1' });
    expect(inquiry?.note).toBeNull();
  });

  it('seeds the "user" account type in environments created after the upgrade', async () => {
    const environment = await createEnvironment(db(), {
      id: testId('env'),
      organizationId: seed.organizations[1],
      kind: 'production',
    });

    const types = await db().execute<{ name: string }>(
      sql`select name from account_types where environment_id = ${environment.id}`,
    );
    expect(types.rows).toEqual([{ name: 'user' }]);
  });

  it('refuses to stop at a migration that does not exist', async () => {
    await expect(runMigrations(db(), { upTo: '9999_missing' })).rejects.toThrow(
      /no migration is tagged 9999_missing/,
    );
  });

  it('keeps audit logs append-only after the backfill', async () => {
    let error: unknown;
    try {
      await client.query(`update audit_logs set action = 'file.changed'`);
    } catch (caught) {
      error = caught;
    }

    expect(pgErrorCode(error)).toBe('P0001');
  });
});
