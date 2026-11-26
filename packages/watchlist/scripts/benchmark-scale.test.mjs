// @ts-check
import { describe, expect, it } from 'vitest';
import { differenceOf, intervalsOf, pairedPoint, pairedSamples } from './benchmark-paired.mjs';
import {
  compareSet,
  containerName,
  partTarget,
  runsOf,
  setResults,
  splitMatches,
  stepWriter,
} from './benchmark-scale.mjs';

/** @typedef {import('./benchmark-scale.mjs').Observation} Observation */

/**
 * @template Value
 * @param {Value | undefined} value
 * @returns {Value}
 */
const need = (value) => {
  if (value === undefined) {
    throw new Error('missing');
  }
  return value;
};

describe('the shared step options', () => {
  it('checks the budget after every query, writing every line before it stops (calibration-6c follow-up)', async () => {
    /** @type {string[]} */
    const written = [];
    let clock = 0;
    const writer = stepWriter({
      append: async (text) => {
        written.push(text);
      },
      batch: 3,
      budgetMs: 100,
      started: 0,
      now: () => clock,
    });

    clock = 40;
    expect(await writer.add('a')).toBe(false);
    clock = 101;
    expect(await writer.add('b')).toBe(true);

    expect(written).toEqual(['a\nb\n']);
  });

  it('writes a batch at a time, the rest on flush, and nothing for nothing', async () => {
    /** @type {string[]} */
    const written = [];
    const writer = stepWriter({
      append: async (text) => {
        written.push(text);
      },
      batch: 2,
      budgetMs: 1_000,
      started: performance.now(),
    });

    await writer.flush();
    for (const line of ['a', 'b', 'c']) {
      expect(await writer.add(line)).toBe(false);
    }
    expect(written).toEqual(['a\nb\n']);
    await writer.flush();
    await writer.flush();

    expect(written).toEqual(['a\nb\n', 'c\n']);
  });

  it('names a container by its base, the namespace and smoke, and refuses an unsafe namespace', () => {
    expect(containerName('evaluation-6-100k', {})).toBe('evaluation-6-100k');
    expect(containerName('evaluation-6-100k', { smoke: true })).toBe('evaluation-6-100k-smoke');
    expect(containerName('evaluation-6-100k', { namespace: 'base' })).toBe(
      'evaluation-6-100k-base',
    );
    expect(containerName('evaluation-6-2m', { namespace: 'head-2', smoke: true })).toBe(
      'evaluation-6-2m-head-2-smoke',
    );
    expect(() => containerName('evaluation-6-2m', { namespace: 'Base!' })).toThrow(RangeError);
    expect(() => containerName('evaluation-6-2m', { namespace: '' })).toThrow(RangeError);
  });

  it('sizes each part of a table as the performance import does', () => {
    expect(partTarget(2_000_000, 1, 8)).toBe(250_000);
    expect(partTarget(2_000_000, 8, 8)).toBe(2_000_000);
    expect(partTarget(100_000, 1, 1)).toBe(100_000);
    expect(partTarget(2_000_000, 5, 12)).toBe(833_333);
    expect(() => partTarget(100, 0, 8)).toThrow(RangeError);
    expect(() => partTarget(100, 9, 8)).toThrow(RangeError);
    expect(() => partTarget(100, 1, 1.5)).toThrow(RangeError);
  });
});

describe('splitMatches', () => {
  it('keeps the population’s ids and counts the table’s own entries', () => {
    expect(splitMatches(['HZ-P-000001', 'BS-0000001', 'HZ-C-000002', 'BP-1'], 'HZ-')).toEqual({
      matched: ['HZ-P-000001', 'HZ-C-000002'],
      fixed: 2,
    });
    expect(splitMatches([], 'HZ-')).toEqual({ matched: [], fixed: 0 });
  });
});

/** @param {Record<string, string[]>} matched @param {Record<string, number>} [fixed] */
const presets = (matched, fixed = {}) =>
  Object.fromEntries(
    Object.entries(matched).map(([preset, ids]) => [
      preset,
      {
        matched: ids,
        fixed: fixed[preset] ?? 0,
        limits: preset === 'strict' && ids.length === 0 ? ['lossy_script'] : [],
        errors: [],
      },
    ]),
  );

/** @type {Observation[]} */
const OBSERVATIONS = [
  {
    key: 'P:1',
    set: 'persons',
    identity: 'HZ-P-1',
    source: 'typo',
    presets: presets({ strict: [], tolerant: ['HZ-P-1'] }, { tolerant: 2 }),
  },
  {
    key: 'P:2',
    set: 'persons',
    identity: 'HZ-P-2',
    source: 'exact',
    presets: presets({ strict: ['HZ-P-2'], tolerant: ['HZ-P-2', 'HZ-P-1'] }),
  },
  {
    key: 'C:1',
    set: 'companies',
    identity: 'HZ-C-1',
    source: 'exact',
    presets: presets({ strict: ['HZ-C-1'], tolerant: ['HZ-C-1'] }),
  },
  {
    key: 'K:1',
    set: 'customers',
    identity: null,
    source: null,
    presets: presets({ strict: [], tolerant: [] }, { tolerant: 1 }),
  },
  {
    key: 'K:2',
    set: 'customers',
    identity: null,
    source: null,
    presets: presets({ strict: ['HZ-P-2'], tolerant: ['HZ-P-2'] }),
  },
  {
    key: 'K:3',
    set: 'customers',
    identity: null,
    source: null,
    presets: presets({ strict: [], tolerant: [] }, { strict: 1, tolerant: 1 }),
  },
];
const IDENTITIES = ['HZ-P-1', 'HZ-P-2', 'HZ-C-1'];
const PERSONS = /** @type {const} */ ({ cases: 'persons', customers: 'customers' });

describe('runsOf', () => {
  it('builds one paired run per preset from a set’s cases and customers, less the excluded', () => {
    const runs = runsOf(OBSERVATIONS, {
      ...PERSONS,
      presets: ['strict', 'tolerant'],
      identities: IDENTITIES,
      excluded: new Set(['K:3']),
    });

    expect(runs.tolerant).toEqual({
      identities: IDENTITIES,
      cases: [
        { id: 'P:1', identity: 'HZ-P-1', source: 'typo', matched: ['HZ-P-1'], fixed: 2 },
        { id: 'P:2', identity: 'HZ-P-2', source: 'exact', matched: ['HZ-P-2', 'HZ-P-1'], fixed: 0 },
      ],
      customers: [
        { id: 'K:1', matched: [], fixed: 1 },
        { id: 'K:2', matched: ['HZ-P-2'], fixed: 0 },
      ],
    });
    expect(
      runsOf(OBSERVATIONS, {
        cases: 'companies',
        customers: null,
        presets: ['strict'],
        identities: IDENTITIES,
      }).strict?.customers,
    ).toEqual([]);
  });
});

describe('setResults', () => {
  const options = {
    ...PERSONS,
    presets: ['strict', 'tolerant'],
    identities: IDENTITIES,
    excluded: new Set(['K:3']),
    replicates: 300,
    seed: 'scale-test',
    label: 'scale-test/persons',
  };

  it('gives each preset its point, its intervals from one stream, the diagnostics and the indistinguishable', () => {
    const results = setResults(OBSERVATIONS, options);
    const runs = runsOf(OBSERVATIONS, options);
    const samples = pairedSamples([need(runs.strict), need(runs.tolerant)], {
      replicates: 300,
      seed: 'scale-test',
      label: 'scale-test/persons',
    });

    expect(results.tolerant?.point).toEqual(pairedPoint(need(runs.tolerant)));
    expect(results.strict?.intervals).toEqual(intervalsOf(need(samples[0])));
    expect(results.tolerant?.intervals).toEqual(intervalsOf(need(samples[1])));
    expect(results.strict?.diagnostics).toEqual({
      misses: 1,
      missesFlagged: 1,
      truncated: { cases: 0, customers: 0 },
      errored: { cases: 0, customers: 0 },
    });
    expect(results.strict?.indistinguishable).toEqual({ customers: 1, alerted: 1 });
    expect(results.tolerant?.point.alerts).toMatchObject({ customers: 2, alerted: 2 });
  });
});

describe('compareSet', () => {
  it('gives base, head and head minus base on the same draws', () => {
    const head = OBSERVATIONS.map((item) =>
      item.key === 'P:1'
        ? { ...item, presets: presets({ strict: ['HZ-P-1'], tolerant: ['HZ-P-1'] }) }
        : item,
    );
    const options = {
      ...PERSONS,
      presets: ['strict', 'tolerant'],
      identities: IDENTITIES,
      replicates: 300,
      seed: 'compare-test',
    };
    const comparison = compareSet(OBSERVATIONS, head, options);
    const baseRuns = runsOf(OBSERVATIONS, options);
    const headRuns = runsOf(head, options);
    const [baseStrict, , headStrict] = pairedSamples(
      [baseRuns.strict, baseRuns.tolerant, headRuns.strict, headRuns.tolerant].map(need),
      { replicates: 300, seed: 'compare-test' },
    );

    expect(comparison.strict?.difference.overall).toBe(0.5);
    expect(comparison.strict?.difference.recall).toEqual({ typo: 1, exact: 0 });
    expect(comparison.tolerant?.difference.overall).toBe(0);
    expect(comparison.strict?.base).toEqual(pairedPoint(need(baseRuns.strict)));
    expect(comparison.strict?.differenceIntervals).toEqual(
      intervalsOf(differenceOf(need(baseStrict), need(headStrict))),
    );
    expect(() => compareSet(OBSERVATIONS, head.slice(1), options)).toThrow(RangeError);
  });
});
