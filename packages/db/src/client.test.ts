import { Pool } from 'pg';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { createDatabase, type Database, type Db } from './client.js';
import type { TestDatabase } from './testing.js';

// pg pools connect lazily, so no database is needed to build the client.
const pool = new Pool({ connectionString: 'postgres://user:pass@127.0.0.1:1/unused' });

afterAll(async () => {
  await pool.end();
});

type TransactionOf<T extends { transaction: (...args: never[]) => unknown }> = Parameters<
  Parameters<T['transaction']>[0]
>[0];

describe('createDatabase', () => {
  it('wraps a pg pool in a Drizzle client that knows the schema', () => {
    const db = createDatabase(pool);

    expect(db.$client).toBe(pool);
    expect(Object.keys(db.query)).toEqual(
      expect.arrayContaining(['organizations', 'environments', 'apiKeys', 'inquiries', 'webhooks']),
    );
  });
});

describe('Db', () => {
  it('accepts node-postgres, PGlite and their transactions, so repositories run on either', () => {
    expectTypeOf<Database>().toExtend<Db>();
    expectTypeOf<TestDatabase['db']>().toExtend<Db>();
    expectTypeOf<TransactionOf<Database>>().toExtend<Db>();
    expectTypeOf<TransactionOf<TestDatabase['db']>>().toExtend<Db>();
    expectTypeOf<TransactionOf<Db>>().toExtend<Db>();
  });
});
