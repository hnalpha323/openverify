/**
 * `pnpm --filter @openverify/api face-scan:benchmark` (C42.4, `scripts/face-scan-benchmark.ts`):
 * the command line, the measurement on a small synthetic gallery (PGlite), its clean-up and its
 * output line. Vitest runs `src/**` tests, so the script's tests live here. Synthetic data only.
 */
import { faceTemplates, organizations } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_BENCHMARK_RUNS,
  DEFAULT_BENCHMARK_TEMPLATES,
  FaceScanBenchmarkUsageError,
  describeFaceScanBenchmark,
  measureFaceScan,
  parseFaceScanBenchmarkArgs,
} from '../scripts/face-scan-benchmark.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('parseFaceScanBenchmarkArgs', () => {
  it('measures 50,000 templates three times by default', () => {
    expect(parseFaceScanBenchmarkArgs([])).toEqual({
      templates: DEFAULT_BENCHMARK_TEMPLATES,
      runs: DEFAULT_BENCHMARK_RUNS,
    });
    expect(DEFAULT_BENCHMARK_TEMPLATES).toBe(50_000);
  });

  it('reads --templates and --runs in both spellings', () => {
    expect(parseFaceScanBenchmarkArgs(['--templates=1000', '--runs', '5'])).toEqual({
      templates: 1000,
      runs: 5,
    });
  });

  it.each([
    [['--templates=0']],
    [['--templates=200001']],
    [['--runs=21']],
    [['--runs']],
    [['--x']],
  ])('refuses %j with the usage', (argv) => {
    expect(() => parseFaceScanBenchmarkArgs(argv)).toThrow(FaceScanBenchmarkUsageError);
    expect(() => parseFaceScanBenchmarkArgs(argv)).toThrow(/usage: face-scan:benchmark/);
  });
});

describe('measureFaceScan', () => {
  it('scores every synthetic sealed template, then removes what it wrote', async () => {
    const result = await measureFaceScan(database.db, { templates: 25, runs: 2 });

    expect(result).toMatchObject({ templates: 25, searched: 25, truncated: false });
    expect(result.timingsMs).toHaveLength(2);
    expect(result.medianMs).toBeGreaterThanOrEqual(0);
    expect(result.seedMs).toBeGreaterThanOrEqual(0);
    expect(await database.db.select().from(faceTemplates)).toEqual([]);
    expect(await database.db.select().from(organizations)).toEqual([]);
  });
});

describe('describeFaceScanBenchmark', () => {
  it('prints the timing and counts, never data', () => {
    expect(
      describeFaceScanBenchmark({
        templates: 50_000,
        searched: 50_000,
        truncated: false,
        timingsMs: [2100.4, 2050.2, 2200.9],
        medianMs: 2100.4,
        seedMs: 30_000,
      }),
    ).toBe(
      'face-scan:benchmark: decrypted and scored 50000 sealed templates in 2100 ms ' +
        '(median of 3 runs: 2050, 2100, 2201 ms; seeding took 30000 ms).',
    );
  });
});
