/**
 * Phase 3 migrations on the production server image. drizzle-orm runs every pending migration
 * in one transaction, so `ALTER TYPE verification_status ADD VALUE 'needs_review'` (0011) runs
 * inside it: Postgres allows that, as long as nothing in the same transaction uses the value.
 * These tests prove the value works once the batch has committed, both on an empty database and
 * on one upgraded from the Phase 2 schema with rows in it.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import {
  createVerification,
  getVerification,
  replaceVerificationChecks,
  setVerificationStatus,
} from './repositories/verifications.js';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  testId,
  startIntegrationPostgres,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
const pools: Pool[] = [];

beforeAll(async () => {
  setDefaultKeyring(keyring);
  container = await startIntegrationPostgres();
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await Promise.all(pools.map((pool) => pool.end()));
  await container?.stop();
});

/** A fresh database on the container, so each scenario starts empty. */
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

async function reviewAVerification(db: Database) {
  const { environment } = await createTestTenant(db);
  const { inquiry } = await createTestInquiry(db, environment.id);
  const verification = await createVerification(db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await setVerificationStatus(db, environment.id, verification.id, { to: 'submitted' });
  await replaceVerificationChecks(db, environment.id, verification.id, [
    {
      name: 'id_mrz_detection',
      status: 'not_applicable',
      type: 'user_behavior',
      requirement: 'required',
      reasons: ['input_missing'],
      stage: 'beta',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    },
  ]);
  const moved = await setVerificationStatus(db, environment.id, verification.id, {
    from: 'submitted',
    to: 'needs_review',
  });
  return { moved, read: await getVerification(db, environment.id, verification.id) };
}

describe('Phase 3 migrations on Postgres 17', () => {
  it('apply in one batch on an empty database, after which needs_review can be stored', async () => {
    const db = await freshDatabase('phase3_empty');

    await runMigrations(db);

    const { moved, read } = await reviewAVerification(db);
    expect(moved?.status).toBe('needs_review');
    expect(read?.checks).toMatchObject([{ stage: 'beta', reasons: ['input_missing'] }]);
  });

  it('upgrade a Phase 2 database with rows in it the same way', async () => {
    const db = await freshDatabase('phase3_upgrade');
    await runMigrations(db, { upTo: '0009_api_logs_user_id_index' });
    const { environment } = await createTestTenant(db);
    await createTestInquiryOnEarlierSchema(db, environment.id);

    await runMigrations(db);

    const { moved } = await reviewAVerification(db);
    expect(moved?.status).toBe('needs_review');
    const applied = await db.execute(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    expect(applied.rows).toEqual([{ count: migrationTags().length }]);
  });
});
