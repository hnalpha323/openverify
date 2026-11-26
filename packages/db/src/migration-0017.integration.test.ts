/**
 * Migration 0017 (Phase 5, Workflow 5A Stage 1b, C53.2) on the production server image: the four
 * Workflow 5A tables on an empty database and on one upgraded from 0016 with rows in it, their
 * one-open-challenge indexes under concurrent writers, the cascade from the inquiry, and C16
 * redaction of what they seal. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import {
  getCryptoChallenge,
  openCryptoChallengeEvidence,
} from './repositories/crypto-challenges.js';
import { getOtpChallenge, openOtpChallengeDestination } from './repositories/otp-challenges.js';
import { redactInquiryRecords } from './repositories/redaction.js';
import { getVerificationInputs } from './repositories/verification-inputs.js';
import { createVerification } from './repositories/verifications.js';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestInquiryOnEarlierSchema,
  createTestVerificationOnEarlierSchema,
  createTestTenant,
  seedCryptoChallenge,
  seedOtpChallenge,
  seedOtpVerificationState,
  seedVerificationInputs,
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

/** An inquiry with one verification of each Workflow 5A kind and a row in each table. */
async function seedEveryTable(db: Database) {
  const { environment } = await createTestTenant(db);
  const env = environment.id;
  const { inquiry } = await createTestInquiry(db, env);
  const of = async (type: 'government_id' | 'aamva' | 'phone_number' | 'crypto_wallet') =>
    (await createVerification(db, env, { id: testId('ver'), inquiryId: inquiry.id, type })).id;
  const governmentId = await of('government_id');
  const aamva = await of('aamva');
  const phone = await of('phone_number');
  const wallet = await of('crypto_wallet');
  await seedVerificationInputs(db, env, {
    verificationId: aamva,
    inquiryId: inquiry.id,
    values: { 'name-last': 'Synthetic', 'identification-number': 'S1234567' },
    source: 'government_id',
    sourceVerificationId: governmentId,
  });
  const otp = await seedOtpChallenge(db, env, {
    verificationId: phone,
    inquiryId: inquiry.id,
    channel: 'sms',
    destination: '+15550100012',
    destinationIndex: 'f'.repeat(64),
  });
  await seedOtpVerificationState(db, env, {
    verificationId: phone,
    inquiryId: inquiry.id,
    sends: 1,
  });
  const challenge = await seedCryptoChallenge(db, env, {
    verificationId: wallet,
    inquiryId: inquiry.id,
    chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    walletAddress: 'SyntheticSolanaAddress1111111111111111111111',
    message: 'synthetic sign-in',
  });
  return { env, inquiryId: inquiry.id, aamva, phone, wallet, otp, challenge };
}

async function count(db: Database, table: string, inquiryId: string): Promise<number> {
  const result = await db.execute(
    `select count(*)::int as count from ${table} where inquiry_id = '${inquiryId}'`,
  );
  return Number(result.rows[0]?.count);
}

const TABLES = [
  'verification_inputs',
  'otp_challenges',
  'otp_verification_states',
  'crypto_challenges',
];

describe('Phase 5 migration 0017 on Postgres 17', () => {
  it('creates the tables on an empty database; each row goes with its inquiry', async () => {
    const db = await freshDatabase('phase5_0017_empty');
    await runMigrations(db);
    const seeded = await seedEveryTable(db);

    for (const table of TABLES) {
      expect(await count(db, table, seeded.inquiryId), table).toBe(1);
    }
    await db.execute(`delete from inquiries where id = '${seeded.inquiryId}'`);
    for (const table of TABLES) {
      expect(await count(db, table, seeded.inquiryId), table).toBe(0);
    }
  });

  it('upgrades a database at 0016 with rows in it', async () => {
    const db = await freshDatabase('phase5_0017_upgrade');
    await runMigrations(db, { upTo: '0016_phase5_verification_types' });
    const { environment } = await createTestTenant(db);
    const { inquiry } = await createTestInquiryOnEarlierSchema(db, environment.id);
    const before = await createTestVerificationOnEarlierSchema(db, environment.id, {
      inquiryId: inquiry.id,
      type: 'aamva',
    });

    await runMigrations(db);

    await seedVerificationInputs(db, environment.id, {
      verificationId: before.id,
      inquiryId: inquiry.id,
      values: { 'name-first': 'Avery' },
    });
    expect((await getVerificationInputs(db, environment.id, before.id))?.values).toEqual({
      'name-first': 'Avery',
    });
    const applied = await db.execute(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    expect(applied.rows).toEqual([{ count: migrationTags().length }]);
  });

  it('lets only one of two concurrent sends hold the open code (C55.4)', async () => {
    const db = await freshDatabase('phase5_0017_race');
    await runMigrations(db);
    const { environment } = await createTestTenant(db);
    const { inquiry } = await createTestInquiry(db, environment.id);
    const phone = await createVerification(db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'phone_number',
    });
    const send = () =>
      seedOtpChallenge(db, environment.id, {
        verificationId: phone.id,
        inquiryId: inquiry.id,
        channel: 'sms',
        destination: '+15550100013',
      });

    const outcomes = await Promise.allSettled([send(), send()]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('redacts what the tables seal (C53.6)', async () => {
    const db = await freshDatabase('phase5_0017_redact');
    await runMigrations(db);
    const seeded = await seedEveryTable(db);

    await redactInquiryRecords(db, seeded.env, seeded.inquiryId, { at: new Date() });

    expect((await getVerificationInputs(db, seeded.env, seeded.aamva))?.values).toBeNull();
    expect(await openOtpChallengeDestination(db, seeded.env, seeded.otp)).toBeNull();
    expect((await getOtpChallenge(db, seeded.env, seeded.otp))?.destinationIndex).toBeNull();
    expect(await openCryptoChallengeEvidence(db, seeded.env, seeded.challenge)).toEqual({
      walletAddress: null,
      message: null,
      signature: null,
      signedMessage: null,
    });
    expect((await getCryptoChallenge(db, seeded.env, seeded.challenge))?.redactedAt).not.toBeNull();
  });
});
