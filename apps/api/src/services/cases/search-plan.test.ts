/**
 * Workflow 8C review R007: a case search's tagged leaf can use `cases_lower_tags_idx`, the GIN index on
 * `openverify_lower_tags(tags)`, as every other resource's tag filter does. The leaf is explained alone,
 * with sequential and plain index scans turned off, so the plan names the GIN index (a bitmap scan)
 * exactly when the leaf can use it, whatever the table's size. Synthetic ids only.
 */
import { createTestDatabase, testId, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cases } from '@openverify/db';
import { predicateSql } from './search.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function planOf(tag: string): Promise<string> {
  const environmentId = testId('env');
  const where = predicateSql(
    { kind: 'tagged', value: tag },
    { key: new Uint8Array(32), environmentId, fields: new Map() },
  );
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    await tx.execute(sql`set local enable_indexscan = off`);
    const explained = await tx.execute(
      sql`explain select ${cases.id} from ${cases} where ${where}`,
    );
    return (explained as unknown as { rows: Record<string, string>[] }).rows
      .map((row) => Object.values(row).join(''))
      .join('\n');
  });
}

describe('the tagged leaf (R007)', () => {
  it('reads the lower-tags GIN index', async () => {
    expect(await planOf('Watch')).toContain('cases_lower_tags_idx');
  });
});
