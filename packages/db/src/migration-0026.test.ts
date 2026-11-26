/**
 * Migration 0026 (K7C-2, C108), upgrading a database at 0025 with a relation in it, on PGlite.
 * `GET /transactions/:id/relations` reads newest first, and a `many` relation has no cap, so the
 * page must come from an index in that order and not from sorting all of a transaction's rows.
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import { addTransactionRelation } from './repositories/transaction-links.js';
import * as schema from './schema.js';
import {
  createTestAccountOnEarlierSchema,
  createTestTenant,
  PGLITE_EXTENSIONS,
  seedTransaction,
  seedTransactionType,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
let client: PGlite;
const db = () => drizzle({ client, schema });

beforeAll(async () => {
  setDefaultKeyring(keyring);
  client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await runMigrations(db(), { upTo: '0025_phase7c' });
  const { environment } = await createTestTenant(db());
  const type = await seedTransactionType(db(), environment.id);
  const { id: transactionId } = await seedTransaction(db(), environment.id, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  });
  const accountId = await createTestAccountOnEarlierSchema(db(), environment.id);
  await addTransactionRelation(db(), environment.id, {
    transactionId,
    relationSchemaKey: 'payer',
    targetId: accountId,
  });
  await runMigrations(db());
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await client.close();
});

describe('migration 0026: the relations page index', () => {
  it('applies on top of 0025, keeping the rows', async () => {
    const applied = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    const relations = await client.query<{ count: number }>(
      'select count(*)::int as count from transaction_relations',
    );

    expect(applied.rows[0]?.count).toBe(migrationTags().length);
    expect(relations.rows[0]?.count).toBe(1);
  });

  it('answers a deep page from the index, in its order, with no sort', async () => {
    await client.exec('set enable_seqscan = off; set enable_bitmapscan = off');

    const plan = await client.query<{ 'QUERY PLAN': string }>(
      `explain select * from transaction_relations
        where environment_id = 'env_a' and transaction_id = 'txn_a'
          and (created_at, relation_schema_key, target_id) < (now(), 'payer', 'acc_a')
        order by created_at desc, relation_schema_key desc, target_id desc
        limit 11`,
    );
    const lines = plan.rows.map((row) => row['QUERY PLAN']).join('\n');

    expect(lines).toContain('transaction_relations_transaction_created_at_key_target_idx');
    expect(lines).not.toMatch(/Sort/u);
  });
});
