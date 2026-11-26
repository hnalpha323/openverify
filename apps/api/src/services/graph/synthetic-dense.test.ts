/**
 * Phase 7's R007 (Workflow 11D load-harness): `graph:benchmark` gains a dense-neighbourhood shape
 * behind `--shape dense` (strong rings of 100 instead of 10), and the default shape stays byte for
 * byte what the C102.8 gate and the graph-engine template build, on PGlite. Every value key is a
 * hash of the seed: no value, no person.
 */
import { GRAPH_LIMITS } from '@openverify/core';
import type { Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GraphBenchmarkUsageError,
  parseGraphBenchmarkArgs,
} from '../../../scripts/graph-benchmark.js';
import { buildSyntheticGraph, SYNTHETIC_SHAPES } from './synthetic.js';

const databases: TestDatabase[] = [];

async function fresh(): Promise<{ db: Db; environmentId: string }> {
  const database = await createTestDatabase();
  databases.push(database);
  return { db: database.db, environmentId: (await createTestTenant(database.db)).environment.id };
}

afterAll(async () => {
  await Promise.all(databases.map((database) => database.close()));
});

async function rowsOf(db: Db, environmentId: string): Promise<Record<string, unknown>[]> {
  const result: unknown = await db.execute(sql`
    select kind, value_key, account_id from graph_attributes where environment_id = ${environmentId}
    order by kind, value_key, account_id`);
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/** How many accounts hold each value of a kind, the largest first. */
async function holders(db: Db, environmentId: string, kind: number): Promise<number[]> {
  const result: unknown = await db.execute(sql`
    select count(*)::int as n from graph_attributes
    where environment_id = ${environmentId} and kind = ${kind} group by value_key order by n desc`);
  return (result as { rows: { n: number }[] }).rows.map((row) => row.n);
}

const OPTIONS = {
  accounts: 1000,
  seed: 'synthetic-r007',
  hubHolders: 50,
  kinds: ['email', 'phone'] as const,
};

describe('the dense neighbourhood shape (R007)', () => {
  it('names the two shapes', () => {
    expect(SYNTHETIC_SHAPES).toEqual(['default', 'dense']);
  });

  it('keeps the default shape row for row whether or not the option is given', async () => {
    const implicit = await fresh();
    const explicit = await fresh();
    await buildSyntheticGraph(implicit.db, { ...OPTIONS, environmentId: implicit.environmentId });
    await buildSyntheticGraph(explicit.db, {
      ...OPTIONS,
      environmentId: explicit.environmentId,
      shape: 'default',
    });
    const rows = await rowsOf(implicit.db, implicit.environmentId);
    expect(rows.length).toBe(2050);
    expect(await rowsOf(explicit.db, explicit.environmentId)).toEqual(rows);
    expect((await holders(implicit.db, implicit.environmentId, 4))[0]).toBe(10);
  });

  // Workflow 11D review (fix-11d; load-phase11.md finding 14): rings of 100 exceed the default
  // fan-out cap (GRAPH_LIMITS.defaultFanOut, 50), so every ring value was skipped as a hub and each
  // strong hop reached 1 account (skippedHubValues 100 of 100 runs). Dense rings are 50 wide: five
  // times the default shape's, and still traversed under the cap.
  it('writes rings as wide as the default fan-out cap on the strong kinds, chained by the phone rings', async () => {
    const dense = await fresh();
    await buildSyntheticGraph(dense.db, {
      ...OPTIONS,
      environmentId: dense.environmentId,
      shape: 'dense',
    });
    expect(GRAPH_LIMITS.defaultFanOut).toBe(50);
    expect(await holders(dense.db, dense.environmentId, 4)).toEqual(
      Array.from({ length: 20 }, () => GRAPH_LIMITS.defaultFanOut),
    );
    const phones = await holders(dense.db, dense.environmentId, 5);
    expect(phones[0]).toBe(50);
    expect(phones.reduce((sum, n) => sum + n, 0)).toBe(1000);
    expect(phones).toHaveLength(21);
  });
});

describe('graph:benchmark --shape (R007)', () => {
  it('reads the dense shape, and no shape by default', () => {
    expect(parseGraphBenchmarkArgs(['--shape', 'dense']).shape).toBe('dense');
    expect(parseGraphBenchmarkArgs(['--shape=default']).shape).toBe('default');
    expect(parseGraphBenchmarkArgs([])).not.toHaveProperty('shape');
    expect(() => parseGraphBenchmarkArgs(['--shape', 'sparse'])).toThrow(GraphBenchmarkUsageError);
    expect(() => parseGraphBenchmarkArgs(['--shape', 'sparse'])).toThrow(
      '--shape is default or dense',
    );
  });
});
