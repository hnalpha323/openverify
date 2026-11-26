/**
 * Migration 0034 (Workflow 10C, `contracts-10c`; the Workflow's one migration) on the production
 * server image (Postgres 17): on an empty database, and on one upgraded from 0033 with a chip
 * challenge in it. `chip_challenges.sandbox_scenario` (C208.1) is `null` on every earlier challenge
 * and held to the five scenarios by `chip_challenges_sandbox_scenario_valid`. Every value is
 * synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  createIntegrationPool,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  startIntegrationPostgres,
  testId,
} from './testing.js';

let container: StartedPostgreSqlContainer | undefined;
const pools: Pool[] = [];

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  container = await startIntegrationPostgres();
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await Promise.all(pools.map((pool) => pool.end()));
  await container?.stop();
});

async function freshDatabase(name: string): Promise<Database> {
  if (!container) throw new Error('no container');
  const admin = createIntegrationPool(container.getConnectionUri());
  pools.push(admin);
  await admin.query(`create database ${name}`);
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  const pool = createIntegrationPool(url.toString());
  pools.push(pool);
  return createDatabase(pool);
}

/** An NFC verification with one superseded challenge, written with the columns every schema since 0018 has. */
async function seedChallenge(db: Database): Promise<string> {
  const { environment } = await createTestTenant(db);
  const { inquiry } = await createTestInquiryOnEarlierSchema(db, environment.id);
  const verification = await createTestVerificationOnEarlierSchema(db, environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id_nfc',
  });
  const id = testId('chc');
  await db.execute(
    `insert into chip_challenges (id, environment_id, verification_id, inquiry_id, nonce_sha256,
       status, expires_at)
     values ('${id}', '${environment.id}', '${verification.id}', '${inquiry.id}', '${'a'.repeat(64)}',
       'superseded', now() + interval '5 minutes')`,
  );
  return id;
}

/** The constraint that refused [statement], or `accepted`; drizzle wraps the driver's error as its cause. */
const refusedBy = async (statement: Promise<unknown>): Promise<string> =>
  statement.then(
    () => 'accepted',
    (error: unknown) => {
      const cause = (error as { cause?: { constraint?: string } }).cause;
      return cause?.constraint ?? String(error);
    },
  );

const scenarioOf = async (db: Database, id: string) =>
  (await db.execute(`select sandbox_scenario from chip_challenges where id = '${id}'`)).rows;

describe('Workflow 10C migration 0034 on Postgres 17', () => {
  it('adds chip_challenges.sandbox_scenario on an empty database, held to its five values', async () => {
    const db = await freshDatabase('phase10c_empty');
    await runMigrations(db);
    const id = await seedChallenge(db);

    expect(await scenarioOf(db, id)).toEqual([{ sandbox_scenario: null }]);
    await db.execute(
      `update chip_challenges set sandbox_scenario = 'tampered-dg1' where id = '${id}'`,
    );
    expect(
      await refusedBy(
        db.execute(`update chip_challenges set sandbox_scenario = 'revoked' where id = '${id}'`),
      ),
    ).toBe('chip_challenges_sandbox_scenario_valid');
    expect(await scenarioOf(db, id)).toEqual([{ sandbox_scenario: 'tampered-dg1' }]);
  });

  it('upgrades a database at 0033 with a challenge in it, which has no scenario', async () => {
    const db = await freshDatabase('phase10c_upgrade');
    await runMigrations(db, { upTo: '0033_phase10b' });
    const id = await seedChallenge(db);

    await runMigrations(db);

    expect(await scenarioOf(db, id)).toEqual([{ sandbox_scenario: null }]);
    await db.execute(`update chip_challenges set sandbox_scenario = 'match' where id = '${id}'`);
    expect(await scenarioOf(db, id)).toEqual([{ sandbox_scenario: 'match' }]);
  });
});
