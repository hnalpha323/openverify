/**
 * C101.8 (Workflow 7B, `api-graph`): the graph benchmark's run on a small seeded graph on PGlite,
 * the same code `graph:benchmark` runs at 1,000,000 accounts on Postgres 17: the build, then each
 * scenario's timings and counts. Only the report's shape is asserted here, never a time.
 */
import type { Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRAPH_BENCHMARK_SCENARIOS, runGraphBenchmark } from './benchmark.js';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('the graph benchmark run (C101.8)', () => {
  it('builds the seeded graph and reports every scenario', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;

    const report = await runGraphBenchmark(db, {
      environmentId,
      accounts: 2000,
      runs: 3,
      seed: 'benchmark-test',
    });

    expect(report.accounts).toBe(2000);
    expect(report.rows).toBe(2000 * 6 + 2000);
    expect(report.scenarios.map(({ name }) => name)).toEqual(
      GRAPH_BENCHMARK_SCENARIOS.map(({ name }) => name),
    );
    for (const scenario of report.scenarios) {
      expect(scenario.runs).toBe(3);
      expect(scenario.p95Ms).toBeGreaterThanOrEqual(scenario.p50Ms);
      expect(scenario.maxMs).toBeGreaterThanOrEqual(scenario.p95Ms);
      expect(scenario.meanAccounts).toBeGreaterThan(0);
    }
    const hub = report.scenarios.find(({ name }) => name.startsWith('hub'));
    expect(hub?.skippedHubValues).toBeGreaterThan(0);
  });
});
