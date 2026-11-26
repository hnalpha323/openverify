/**
 * K7C-R008 (Phase 7 7C "Later phases" R008; Phase 11, Workflow 11B, platform-ops): with
 * `--database-url`, `graph:benchmark` migrates its target and writes up to 2,000,000 synthetic
 * accounts into it. It must refuse, before any migration or write, a target that holds any
 * organization other than its own scratch organization, so it can never write into an install's
 * database. Every value is synthetic.
 */
import type { Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphBenchmarkTargetError, prepareBenchmarkTarget } from '../scripts/graph-benchmark.js';

let database: TestDatabase;
let db: Db;

beforeEach(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterEach(async () => {
  await database.close();
});

async function organizations(): Promise<{ name: string }[]> {
  const result = (await db.execute(sql`select name from organizations order by name`)) as {
    rows: { name: string }[];
  };
  return result.rows;
}

async function environmentCount(): Promise<number> {
  const result = (await db.execute(sql`select count(*)::int as n from environments`)) as {
    rows: { n: number }[];
  };
  return result.rows[0]?.n ?? -1;
}

describe('graph:benchmark --database-url (K7C-R008)', () => {
  it('refuses a target that holds another organization, before any migration or write', async () => {
    await createTestTenant(db, { organizationName: 'An install (synthetic)' });
    const before = await organizations();
    const environmentsBefore = await environmentCount();
    const migrate = vi.fn(() => Promise.resolve());

    await expect(prepareBenchmarkTarget(db, migrate)).rejects.toBeInstanceOf(
      GraphBenchmarkTargetError,
    );

    expect(migrate).not.toHaveBeenCalled();
    expect(await organizations()).toEqual(before);
    expect(await environmentCount()).toBe(environmentsBefore);
  });

  it('names the reason without naming the organization it found', async () => {
    await createTestTenant(db, { organizationName: 'Canary org name (synthetic)' });

    const refusal = await prepareBenchmarkTarget(db, () => Promise.resolve()).catch(
      (error: unknown) => error as Error,
    );

    expect(refusal).toBeInstanceOf(GraphBenchmarkTargetError);
    expect((refusal as Error).message).toMatch(/holds an organization other than/u);
    expect((refusal as Error).message).not.toContain('Canary');
  });

  it('accepts a target with no organization and makes its scratch environment once', async () => {
    const migrate = vi.fn(() => Promise.resolve());

    const first = await prepareBenchmarkTarget(db, migrate);
    const second = await prepareBenchmarkTarget(db, migrate);

    expect(second).toBe(first);
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(await organizations()).toEqual([{ name: 'Graph benchmark (synthetic)' }]);
  });

  it('accepts an empty database, which has no organizations table yet', async () => {
    const execute = vi.fn(() => Promise.resolve({ rows: [{ present: false }] }));
    const migrate = vi.fn(() => Promise.reject(new Error('stop after the check')));

    await expect(prepareBenchmarkTarget({ execute } as unknown as Db, migrate)).rejects.toThrow(
      'stop after the check',
    );

    expect(migrate).toHaveBeenCalledTimes(1);
  });
});
