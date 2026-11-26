/**
 * Migration 0025 (Workflow 7C; K7B-5, owner decision 9 after Workflow 7B), upgrading a database at
 * 0024 with rows in it, on PGlite. The one-live-file index reads "not deleted and not redacted", so
 * a replaced file stays findable by redaction and the C16 purge until its object is gone. A file an
 * earlier version marked deleted stays as it was. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  createTestTenant,
  PGLITE_EXTENSIONS,
  seedTransaction,
  seedTransactionFile,
  seedTransactionType,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
let client: PGlite;
let transactionId: string;
let environmentId: string;
const db = () => drizzle({ client, schema });

beforeAll(async () => {
  setDefaultKeyring(keyring);
  client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await runMigrations(db(), { upTo: '0024_phase7b' });
  const { environment } = await createTestTenant(db());
  environmentId = environment.id;
  const type = await seedTransactionType(db(), environmentId);
  ({ id: transactionId } = await seedTransaction(db(), environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  }));
  await seedTransactionFile(db(), environmentId, { transactionId, deletedAt: new Date() });
  await seedTransactionFile(db(), environmentId, { transactionId });
  await runMigrations(db());
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await client.close();
});

describe('migration 0025: the one-live-file index', () => {
  it('applies on top of 0024, keeping the rows', async () => {
    const applied = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    const files = await client.query<{ count: number }>(
      'select count(*)::int as count from transaction_files',
    );

    expect(applied.rows[0]?.count).toBe(migrationTags().length);
    expect(files.rows[0]?.count).toBe(2);
  });

  it('still refuses a second live file, and lets a redacted one stand beside a new one', async () => {
    await expect(seedTransactionFile(db(), environmentId, { transactionId })).rejects.toThrow();

    await client.query(
      'update transaction_files set redacted_at = now() where transaction_id = $1 and deleted_at is null',
      [transactionId],
    );

    await expect(
      seedTransactionFile(db(), environmentId, { transactionId }),
    ).resolves.toHaveProperty('storageKey');
  });
});
