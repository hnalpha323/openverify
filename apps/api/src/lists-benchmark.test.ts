/**
 * Workflow 7B's list calibrations (Workflow 11D load-harness): `scripts/lists-benchmark.ts`, rebuilt
 * from C99.2's benchmark text, on PGlite at a small size: the heavy-headed fuzzy list seeded and
 * resumed, its probes measured with and without `--cap`, and the cold face list opened on an empty
 * cache. Every name is from the generators; every template synthetic. Vitest runs `src/**` tests,
 * so the script's tests live here.
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { setDefaultKeyring } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LISTS_BENCHMARK_DEFAULTS,
  ListsBenchmarkUsageError,
  benchmarkState,
  coldFaceList,
  measureFuzzyList,
  nameLaw,
  parseListsBenchmarkArgs,
  quantile,
  seedFuzzyList,
} from '../scripts/lists-benchmark.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
  setDefaultKeyring(undefined);
});

describe('lists-benchmark arguments', () => {
  it('takes one step a call with its options', () => {
    expect(parseListsBenchmarkArgs(['--seed'])).toEqual({
      step: '--seed',
      ...LISTS_BENCHMARK_DEFAULTS,
    });
    expect(parseListsBenchmarkArgs(['--measure', '--probes', '30', '--cap', '500'])).toMatchObject({
      step: '--measure',
      probes: 30,
      cap: 500,
    });
    expect(parseListsBenchmarkArgs(['--cold-list', '--faces', '10']).faces).toBe(10);
    expect(parseListsBenchmarkArgs(['--seed', '--table-seed', 'abc']).tableSeed).toBe('abc');
  });

  it.each([
    [[]],
    [['--seed', '--measure']],
    [['--seed', '--items', '5']],
    [['--seed', '--nope', '1']],
    [['--seed', '--table-seed', 'a b']],
  ])('refuses %j', (argv) => {
    expect(() => parseListsBenchmarkArgs(argv)).toThrow(ListsBenchmarkUsageError);
  });

  it('reads nearest-rank quantiles', () => {
    expect(quantile([3, 1, 2, 4], 0.5)).toBe(2);
    expect(quantile([], 0.95)).toBe(0);
  });

  it('draws the same heavy-headed names from the same seed', () => {
    const a = nameLaw('x', 'items');
    const b = nameLaw('x', 'items');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const probes = nameLaw('x', 'probes');
    const items = new Set(Array.from({ length: 200 }, () => a()['name-last']));
    expect(
      Array.from({ length: 50 }, () => probes()['name-last']).some((last) => items.has(last)),
    ).toBe(true);
  });
});

describe('the fuzzy list and the cold face list, small', () => {
  it('seeds and resumes, then measures the probes with and without a cap', async () => {
    const state = await benchmarkState(database.db);
    expect(await benchmarkState(database.db)).toEqual(state);
    const first = await seedFuzzyList(database.db, state, {
      items: 600,
      tableSeed: 'unit',
      budgetMs: 0,
    });
    expect(first).toEqual({ items: 0, written: 0, complete: false });
    const seeded = await seedFuzzyList(database.db, state, { items: 600, tableSeed: 'unit' });
    expect(seeded).toEqual({ items: 600, written: 600, complete: true });
    expect(
      (await seedFuzzyList(database.db, state, { items: 600, tableSeed: 'unit' })).written,
    ).toBe(0);
    const shipped = await measureFuzzyList(database.db, state, { probes: 12, tableSeed: 'unit' });
    expect(shipped).toMatchObject({ items: 600, probes: 12, cap: null, limitExceeded: 0 });
    expect(shipped.probeMs.max).toBeGreaterThanOrEqual(shipped.probeMs.p50);
    const tight = await measureFuzzyList(database.db, state, {
      probes: 12,
      cap: 1,
      tableSeed: 'unit',
    });
    expect(tight.cap).toBe(1);
    expect(tight.limitExceeded).toBeGreaterThan(0);
    expect(tight.lastNamesOverCap).toBeGreaterThan(0);
  });

  it('opens a full face list on an empty cache, once written', async () => {
    const state = await benchmarkState(database.db);
    const cold = await coldFaceList(database.db, state, { faces: 40, tableSeed: 'unit' });
    expect(cold).toMatchObject({ faces: 40, held: true });
    expect(cold.cacheBytes).toBeGreaterThan(40 * 128 * 4);
    const again = await coldFaceList(database.db, await benchmarkState(database.db), {
      faces: 40,
      tableSeed: 'unit',
    });
    expect(again.faces).toBe(40);
  });
});
