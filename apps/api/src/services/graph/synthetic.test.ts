/**
 * C101.8, C102.8 (owner decision 17 after Workflow 7B): the synthetic graph built with concurrent
 * batches (the graph-engine template's build) holds exactly the rows of the sequential build (the
 * benchmark's), on PGlite. Every value key is a hash of the seed: no value, no person.
 */
import type { Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSyntheticGraph, syntheticAccountId, syntheticValueKey } from './synthetic.js';

// Synthetic account ids are `acc_<n>` and an account id is unique in a database, so each build
// gets a database of its own.
const databases: TestDatabase[] = [];

/** A new database with one environment. */
async function fresh(): Promise<{ db: Db; environmentId: string }> {
  const database = await createTestDatabase();
  databases.push(database);
  return { db: database.db, environmentId: (await createTestTenant(database.db)).environment.id };
}

afterAll(async () => {
  await Promise.all(databases.map((database) => database.close()));
});

/** Every row of the environment's graph and accounts, without the environment. */
async function graphOf(db: Db, environmentId: string) {
  const attributes: unknown = await db.execute(sql`
    select kind, value_key, key_id, account_id, source_type, source_id from graph_attributes
    where environment_id = ${environmentId}
    order by kind, value_key, account_id`);
  const accounts: unknown = await db.execute(sql`
    select id from accounts where environment_id = ${environmentId} order by id`);
  return {
    attributes: (attributes as { rows: Record<string, unknown>[] }).rows,
    accounts: (accounts as { rows: { id: string }[] }).rows.map(({ id }) => id),
  };
}

describe('buildSyntheticGraph with concurrent batches (decision 17)', () => {
  it('writes the rows of the sequential build, whatever the batch size', async () => {
    const options = {
      accounts: 2000,
      seed: 'synthetic-test',
      hubHolders: 300,
      kinds: ['email', 'phone', 'ip'] as const,
      weakAccounts: [800, 1200] as const,
    };
    const sequential = await fresh();
    const concurrent = await fresh();

    const one = await buildSyntheticGraph(sequential.db, {
      ...options,
      environmentId: sequential.environmentId,
    });
    const many = await buildSyntheticGraph(concurrent.db, {
      ...options,
      environmentId: concurrent.environmentId,
      batchSize: 170,
      concurrency: 4,
    });

    expect(one).toEqual({ accounts: 2000, rows: 2000 * 2 + 400 + 300, batches: 1 });
    expect(many).toEqual({ accounts: 2000, rows: one.rows, batches: 12 });
    const left = await graphOf(sequential.db, sequential.environmentId);
    const right = await graphOf(concurrent.db, concurrent.environmentId);
    expect(right.accounts).toEqual(left.accounts);
    expect(right.attributes).toEqual(left.attributes);
    expect(left.accounts.length).toBe(2000);
    expect(left.attributes).toContainEqual({
      kind: 4,
      value_key: syntheticValueKey('synthetic-test', 'email', 123),
      key_id: 'synthetic-1',
      account_id: syntheticAccountId(1234),
      source_type: 'account',
      source_id: syntheticAccountId(1234),
    });
  });

  it('resumes a concurrent build from the first batch, since one may have stopped behind a later one', async () => {
    const { db, environmentId } = await fresh();
    const options = { environmentId, accounts: 1000, seed: 'synthetic-resume', batchSize: 100 };
    // A concurrent build stopped with its last batch written and an earlier one missing.
    await buildSyntheticGraph(db, { ...options, accounts: 1000 });
    await db.execute(sql`
      delete from accounts where environment_id = ${environmentId}
        and id between ${syntheticAccountId(100)} and ${syntheticAccountId(199)}`);

    const resumed = await buildSyntheticGraph(db, { ...options, concurrency: 2 });

    expect(resumed).toEqual({ accounts: 1000, rows: 1000 * 6 + 1000, batches: 10 });
  });

  it('refuses a concurrency below one', async () => {
    const { db, environmentId } = await fresh();

    await expect(
      buildSyntheticGraph(db, { environmentId, accounts: 10, seed: 's', concurrency: 0 }),
    ).rejects.toThrow('concurrency must be a whole number of at least 1');
  });
});
