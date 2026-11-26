/**
 * Migration 0018 (Phase 5, Workflow 5B Stage 1, C53.3) on the production server image: the four
 * verification tables and the five install-wide trust tables on an empty database and on one
 * upgraded from 0017 with rows in it, the one open chip challenge under concurrent writers, the
 * cascade from the inquiry, C16 redaction of what they seal, and the production trust-store loader
 * that never returns a sandbox-only anchor (C62.8). Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import { openBusinessRegistryRecord } from './repositories/business-registry-records.js';
import { openChipChallengeEvidence } from './repositories/chip-challenges.js';
import { getChipRead, openChipReadEvidence } from './repositories/chip-reads.js';
import {
  getDocumentExtraction,
  openDocumentExtractionFields,
} from './repositories/document-extractions.js';
import { redactInquiryRecords } from './repositories/redaction.js';
import { hasNonSandboxTrustAnchor, loadTrustStore } from './repositories/trust-anchors.js';
import { createVerification } from './repositories/verifications.js';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestInquiryOnEarlierSchema,
  createTestVerificationOnEarlierSchema,
  createTestTenant,
  seedBusinessRegistryRecord,
  seedChipChallenge,
  seedChipRead,
  seedDocumentExtraction,
  seedTrustAnchor,
  seedTrustAnchorMembership,
  seedTrustAnchorSource,
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

/** An inquiry with one verification of each Workflow 5B kind and a row in each table. */
async function seedEveryTable(db: Database) {
  const { environment } = await createTestTenant(db);
  const env = environment.id;
  const { inquiry } = await createTestInquiry(db, env);
  const of = async (type: 'document' | 'government_id_nfc' | 'database_business') =>
    (await createVerification(db, env, { id: testId('ver'), inquiryId: inquiry.id, type })).id;
  const document = await of('document');
  const chip = await of('government_id_nfc');
  const business = await of('database_business');
  await seedDocumentExtraction(db, env, {
    verificationId: document,
    inquiryId: inquiry.id,
    fields: { name: 'QUINN VALEMONT' },
  });
  const challenge = await seedChipChallenge(db, env, {
    verificationId: chip,
    inquiryId: inquiry.id,
    status: 'submitted',
    aaResponse: 'c3ludGhldGlj',
  });
  await seedChipRead(db, env, {
    verificationId: chip,
    inquiryId: inquiry.id,
    fields: { 'name-last': 'VALEMONT' },
    sodSignatureIndex: 'a'.repeat(64),
  });
  await seedBusinessRegistryRecord(db, env, {
    verificationId: business,
    inquiryId: inquiry.id,
    record: { recordId: 'SANDBOX0001', legalName: 'Utopia Widgets Ltd' },
  });
  return { env, inquiryId: inquiry.id, document, chip, business, challenge };
}

async function count(db: Database, table: string, inquiryId: string): Promise<number> {
  const result = await db.execute(
    `select count(*)::int as count from ${table} where inquiry_id = '${inquiryId}'`,
  );
  return Number(result.rows[0]?.count);
}

const TABLES = [
  'document_extractions',
  'chip_challenges',
  'chip_reads',
  'business_registry_records',
];

describe('Phase 5 migration 0018 on Postgres 17', () => {
  it('creates the tables on an empty database; each row goes with its inquiry', async () => {
    const db = await freshDatabase('phase5_0018_empty');
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

  it('upgrades a database at 0017 with rows in it', async () => {
    const db = await freshDatabase('phase5_0018_upgrade');
    await runMigrations(db, { upTo: '0017_phase5_inputs_otp_crypto' });
    const { environment } = await createTestTenant(db);
    const { inquiry } = await createTestInquiryOnEarlierSchema(db, environment.id);
    const before = await createTestVerificationOnEarlierSchema(db, environment.id, {
      inquiryId: inquiry.id,
      type: 'document',
    });

    await runMigrations(db);

    await seedDocumentExtraction(db, environment.id, {
      verificationId: before.id,
      inquiryId: inquiry.id,
      fields: { issuer: 'Utopia Water Board' },
    });
    expect(await openDocumentExtractionFields(db, environment.id, before.id)).toEqual({
      issuer: 'Utopia Water Board',
    });
    const applied = await db.execute(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    expect(applied.rows).toEqual([{ count: migrationTags().length }]);
  });

  it('lets only one of two concurrent challenges be the open one (C62.5)', async () => {
    const db = await freshDatabase('phase5_0018_race');
    await runMigrations(db);
    const { environment } = await createTestTenant(db);
    const { inquiry } = await createTestInquiry(db, environment.id);
    const chip = await createVerification(db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'government_id_nfc',
    });
    const create = () =>
      seedChipChallenge(db, environment.id, { verificationId: chip.id, inquiryId: inquiry.id });

    const outcomes = await Promise.allSettled([create(), create()]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('redacts what the tables seal (C53.6)', async () => {
    const db = await freshDatabase('phase5_0018_redact');
    await runMigrations(db);
    const seeded = await seedEveryTable(db);

    await redactInquiryRecords(db, seeded.env, seeded.inquiryId, { at: new Date() });

    expect(await openDocumentExtractionFields(db, seeded.env, seeded.document)).toBeNull();
    expect(
      (await getDocumentExtraction(db, seeded.env, seeded.document))?.redactedAt,
    ).not.toBeNull();
    expect(await openChipChallengeEvidence(db, seeded.env, seeded.challenge)).toEqual({
      aaResponse: null,
      deviceReport: null,
    });
    expect(await openChipReadEvidence(db, seeded.env, seeded.chip)).toBeNull();
    expect((await getChipRead(db, seeded.env, seeded.chip))?.sodSignatureIndex).toBeNull();
    expect(await openBusinessRegistryRecord(db, seeded.env, seeded.business)).toBeNull();
  });

  it('never gives a production environment a sandbox-only anchor (C62.8)', async () => {
    const db = await freshDatabase('phase5_0018_trust');
    await runMigrations(db);
    await seedTrustAnchorSource(db, { id: 'openverify-sandbox' });
    const utopia = await seedTrustAnchor(db, {
      certificate: new Uint8Array([0x30, 0x01, 0x01]),
      sandboxOnly: true,
    });
    await seedTrustAnchorMembership(db, { sourceId: 'openverify-sandbox', anchorId: utopia });

    expect((await loadTrustStore(db, { environmentKind: 'production' })).anchors).toEqual([]);
    expect(
      (await loadTrustStore(db, { environmentKind: 'sandbox' })).anchors.map((anchor) => anchor.id),
    ).toEqual([utopia]);
    expect(await hasNonSandboxTrustAnchor(db)).toBe(false);
  });
});
