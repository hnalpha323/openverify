/**
 * Workflow 8C review R007 (the sort half, Workflow 8D): a case search, and an export by search,
 * read a page in its sort order from an index, so no page sorts the environment's cases. Each sort
 * and direction is explained as the search runs it, with and without a cursor, with sequential
 * scans turned off so the plan names an index exactly when one serves the order, whatever the
 * table's size. A plan with a Sort node would sort every visible case for each page. Synthetic ids.
 */
import { cases, caseVisibleTo } from '@openverify/db';
import { createTestDatabase, testId, type TestDatabase } from '@openverify/db/testing';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caseSortOrder,
  caseSortPast,
  type CaseSortAttribute,
  type CaseSortDirection,
} from './sort.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function planOf(
  attribute: CaseSortAttribute,
  direction: CaseSortDirection,
  ascending: boolean,
  cursor: boolean,
): Promise<string> {
  const environmentId = testId('env');
  const past: SQL | undefined = cursor
    ? caseSortPast(attribute, direction, ascending, {
        key: '2026-11-03T12:00:00Z',
        id: testId('case'),
      })
    : undefined;
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    const query = tx
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.environmentId, environmentId), caseVisibleTo({ kind: 'system' }), past))
      .orderBy(...caseSortOrder(attribute, direction, ascending))
      .limit(11);
    const explained = await tx.execute(sql`explain ${query}`);
    return (explained as unknown as { rows: Record<string, string>[] }).rows
      .map((row) => Object.values(row).join(''))
      .join('\n');
  });
}

const INDEXES: Record<CaseSortAttribute, Record<CaseSortDirection, string>> = {
  created_at: {
    asc: 'cases_environment_id_created_at_id_idx',
    desc: 'cases_environment_id_created_at_id_idx',
  },
  updated_at: {
    asc: 'cases_environment_id_updated_at_id_idx',
    desc: 'cases_environment_id_updated_at_id_idx',
  },
  resolved_at: {
    asc: 'cases_environment_id_resolved_at_last_asc_idx',
    desc: 'cases_environment_id_resolved_at_last_desc_idx',
  },
  sla_expires_at: {
    asc: 'cases_environment_id_sla_expires_at_last_asc_idx',
    desc: 'cases_environment_id_sla_expires_at_last_desc_idx',
  },
};

describe('a case search reads its page in sort order from an index (R007)', () => {
  for (const attribute of Object.keys(INDEXES) as CaseSortAttribute[]) {
    for (const direction of ['asc', 'desc'] as const) {
      for (const backwards of [false, true]) {
        it(`${attribute} ${direction}, ${backwards ? 'a page before a cursor' : 'the first page and a page after a cursor'}`, async () => {
          const ascending = (direction === 'asc') !== backwards;
          for (const cursor of backwards ? [true] : [false, true]) {
            const plan = await planOf(attribute, direction, ascending, cursor);
            expect(plan).toContain(INDEXES[attribute][direction]);
            expect(plan).not.toMatch(/\bSort\b/);
          }
        });
      }
    }
  }
});
