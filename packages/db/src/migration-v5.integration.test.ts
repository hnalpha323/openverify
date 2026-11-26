/**
 * Migration 0016 (Phase 5, C50.1, C52.4, F23) on the production server image. drizzle-orm runs
 * every pending migration in one transaction, so its `ALTER TYPE ... RENAME VALUE` and
 * `ADD VALUE` statements run inside it: Postgres allows that as long as nothing in the batch uses
 * an added value. These tests prove the new values work once the batch has committed, both on an
 * empty database and on one upgraded from the Phase 4 schema with rows in it, and that no row
 * held the renamed `business` value.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { VERIFICATION_TYPES } from '@openverify/core';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, encryptBytes, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import { createFile } from './repositories/files.js';
import { createVerification, getVerification } from './repositories/verifications.js';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestInquiryOnEarlierSchema,
  createTestVerificationOnEarlierSchema,
  createTestTenant,
  testId,
  startIntegrationPostgres,
} from './testing.js';
import type { FileKind, VerificationType } from './tables/enums.js';

/** C52.4: the Phase 1 kinds, the client's document and chip files, then the server-written two. */
const FILE_KINDS_AFTER_0016 = [
  'front',
  'back',
  'portrait',
  'selfie-center',
  'selfie-left',
  'selfie-right',
  'document',
  'chip-sod',
  'chip-dg1',
  'chip-dg2',
  'chip-dg14',
  'chip-dg15',
  'chip-card-security',
  'chip-card-access',
  'chip-com',
  'document-preview',
  'chip-portrait',
];
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

/** The labels of a Postgres enum, in their sort order. */
async function enumLabels(db: Database, type: string): Promise<string[]> {
  const result = await db.execute(
    `select enumlabel from pg_enum join pg_type on pg_type.oid = enumtypid where typname = '${type}' order by enumsortorder`,
  );
  return result.rows.map((row) => String(row.enumlabel));
}

/** One verification of `type` with one file of each of `kinds`, written and read back. */
async function storeVerification(
  db: Database,
  environmentId: string,
  inquiryId: string,
  type: VerificationType,
  kinds: readonly FileKind[],
) {
  const verification = await createVerification(db, environmentId, {
    id: testId('ver'),
    inquiryId,
    type,
  });
  await storeFiles(db, environmentId, verification.id, kinds);
  return getVerification(db, environmentId, verification.id);
}

/** One file of each of `kinds` for the verification. */
async function storeFiles(
  db: Database,
  environmentId: string,
  verificationId: string,
  kinds: readonly FileKind[],
) {
  const verification = { id: verificationId };
  for (const kind of kinds) {
    const id = testId('file');
    await createFile(db, environmentId, {
      id,
      verificationId: verification.id,
      kind,
      storageKey: `${environmentId}/${kind}`,
      mimeType: 'application/octet-stream',
      byteSize: 4,
      sha256: '0'.repeat(64),
      wrappedDek: encryptBytes(new Uint8Array([1, 2, 3, 4]), keyring, { context: id }).wrappedDek,
    });
  }
}

/**
 * Like {@link storeFiles}, on an earlier schema: written with SQL naming only the columns every
 * schema since 0001 has, because the repository's insert names every column of the current one
 * (Workflow 9A Stage 1b (F) added `files.capture_method`).
 */
async function storeFilesOnEarlierSchema(
  db: Database,
  environmentId: string,
  verificationId: string,
  kinds: readonly FileKind[],
) {
  for (const kind of kinds) {
    const id = testId('file');
    const { wrappedDek } = encryptBytes(new Uint8Array([1, 2, 3, 4]), keyring, { context: id });
    await db.execute(
      sql`insert into files (id, environment_id, verification_id, kind, storage_key, mime_type,
            byte_size, sha256, wrapped_dek)
          values (${id}, ${environmentId}, ${verificationId}, ${kind}::file_kind,
            ${`${environmentId}/${kind}`}, 'application/octet-stream', 4, ${'0'.repeat(64)},
            ${wrappedDek})`,
    );
  }
}

/** Every new type and file kind works once the batch has committed. */
async function storeEveryNewValue(db: Database) {
  const { environment } = await createTestTenant(db);
  const { inquiry } = await createTestInquiry(db, environment.id);
  const stored = [];
  for (const type of ['aamva', 'database_business', 'business_website'] as const) {
    stored.push(await storeVerification(db, environment.id, inquiry.id, type, []));
  }
  stored.push(
    await storeVerification(db, environment.id, inquiry.id, 'document', [
      'document',
      'document-preview',
    ]),
  );
  stored.push(
    await storeVerification(db, environment.id, inquiry.id, 'government_id_nfc', [
      'chip-sod',
      'chip-dg1',
      'chip-dg2',
      'chip-dg14',
      'chip-dg15',
      'chip-card-security',
      'chip-card-access',
      'chip-com',
      'chip-portrait',
    ]),
  );
  return stored.map((verification) => verification?.type);
}

describe('Phase 5 migration 0016 on Postgres 17', () => {
  it('applies in one batch on an empty database, after which every new value can be stored', async () => {
    const db = await freshDatabase('phase5_empty');

    await runMigrations(db);

    expect(await enumLabels(db, 'verification_type')).toEqual([...VERIFICATION_TYPES]);
    expect(await enumLabels(db, 'file_kind')).toEqual(FILE_KINDS_AFTER_0016);
    expect(await storeEveryNewValue(db)).toEqual([
      'aamva',
      'database_business',
      'business_website',
      'document',
      'government_id_nfc',
    ]);
  });

  it('upgrades a Phase 4 database with rows in it, and no row held business', async () => {
    const db = await freshDatabase('phase5_upgrade');
    await runMigrations(db, { upTo: '0015_selfie_captures_face_templates' });
    const { environment } = await createTestTenant(db);
    const { inquiry } = await createTestInquiryOnEarlierSchema(db, environment.id);
    // Written with the columns of the Phase 4 schema (Workflow 7A (H) added verification columns).
    const before = await createTestVerificationOnEarlierSchema(db, environment.id, {
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    await storeFilesOnEarlierSchema(db, environment.id, before.id, ['front', 'back']);
    const held = await db.execute(
      `select count(*)::int as count from verifications where type::text = 'business'`,
    );
    expect(held.rows).toEqual([{ count: 0 }]);

    await runMigrations(db);

    expect(await enumLabels(db, 'verification_type')).toEqual([...VERIFICATION_TYPES]);
    expect(await enumLabels(db, 'file_kind')).toEqual(FILE_KINDS_AFTER_0016);
    expect(await getVerification(db, environment.id, before.id)).toMatchObject({
      type: 'government_id',
      status: 'initiated',
    });
    const files = await db.execute(
      `select kind::text as kind from files where verification_id = '${before.id}' order by files.kind`,
    );
    expect(files.rows).toEqual([{ kind: 'front' }, { kind: 'back' }]);
    expect(await storeEveryNewValue(db)).toHaveLength(5);
    const applied = await db.execute(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    expect(applied.rows).toEqual([{ count: migrationTags().length }]);
  });
});
