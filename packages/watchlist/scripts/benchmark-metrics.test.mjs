// @ts-check
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../src/testing/random.js';
import {
  bootstrapQuality,
  percentile,
  percentileInterval,
  performanceSummary,
  qualityPoint,
  qualityReplicate,
  wilsonInterval,
} from './benchmark-metrics.mjs';

/** @typedef {import('./benchmark-metrics.mjs').QualityObservations} QualityObservations */

const range = (/** @type {number} */ from, /** @type {number} */ to) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('percentile (nearest rank)', () => {
  it('takes the smallest value at or above the fraction, whatever the order', () => {
    const values = range(1, 100).reverse();

    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([3, 1, 2], 0.95)).toBe(3);
  });

  it('leaves its input as it was', () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);

    expect(values).toEqual([3, 1, 2]);
  });

  it('refuses an empty list or a fraction outside (0, 1]', () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
    expect(() => percentile([1], 0)).toThrow(RangeError);
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
  });
});

describe('wilsonInterval', () => {
  it('gives the 95% Wilson score interval of a proportion', () => {
    const [low, high] = wilsonInterval(5, 10) ?? [Number.NaN, Number.NaN];
    expect(low).toBeCloseTo(0.2366, 4);
    expect(high).toBeCloseTo(0.7634, 4);

    const none = wilsonInterval(0, 10) ?? [Number.NaN, Number.NaN];
    expect(none[0]).toBe(0);
    expect(none[1]).toBeCloseTo(0.2775, 4);

    const all = wilsonInterval(10, 10) ?? [Number.NaN, Number.NaN];
    expect(all[0]).toBeCloseTo(0.7225, 4);
    expect(all[1]).toBe(1);
  });

  it('has no interval without trials, and refuses impossible counts', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(() => wilsonInterval(3, 2)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 2)).toThrow(RangeError);
  });
});

describe('percentileInterval', () => {
  it('takes the 2.5th and 97.5th nearest-rank percentiles of the finite samples', () => {
    expect(percentileInterval(range(1, 1000))).toEqual([25, 975]);
    expect(percentileInterval([...range(1, 1000), Number.NaN, Number.POSITIVE_INFINITY])).toEqual([
      25, 975,
    ]);
    expect(percentileInterval(range(1, 100), 0.9)).toEqual([5, 95]);
  });

  it('is null when no sample is finite', () => {
    expect(percentileInterval([])).toBeNull();
    expect(percentileInterval([Number.NaN])).toBeNull();
  });
});

/** Two listed persons and a company; A's case also matched B, the customers matched A or nothing. */
const SMALL = /** @type {QualityObservations} */ ({
  identities: ['A', 'B', 'C'],
  cases: [
    { id: 'c1', identity: 'A', source: 'typo', matched: ['A', 'B'] },
    { id: 'c2', identity: 'B', source: 'typo', matched: [] },
    { id: 'c3', identity: 'C', source: 'exact', matched: ['C'] },
  ],
  customers: [
    { id: 'k1', matched: ['A'] },
    { id: 'k2', matched: [] },
    { id: 'k3', matched: [] },
    { id: 'k4', matched: ['A', 'C'] },
  ],
});

describe('qualityPoint', () => {
  it('counts recall per source, precision over the case matches and alerts per 1,000 customers', () => {
    const point = qualityPoint(SMALL);

    expect(point.recall).toEqual({
      typo: { hits: 1, cases: 2, value: 0.5 },
      exact: { hits: 1, cases: 1, value: 1 },
    });
    expect(point.overall).toEqual({ hits: 2, cases: 3, value: 2 / 3 });
    expect(point.precision).toEqual({ expected: 2, other: 1, value: 2 / 3 });
    expect(point.alerts).toEqual({ customers: 4, alerted: 2, matches: 3, perThousand: 500 });
  });

  it('has no precision without a match and no rate without customers', () => {
    const point = qualityPoint({
      identities: ['A'],
      cases: [{ id: 'c1', identity: 'A', source: 'exact', matched: [] }],
      customers: [],
    });

    expect(point.precision).toEqual({ expected: 0, other: 0, value: null });
    expect(point.alerts).toEqual({ customers: 0, alerted: 0, matches: 0, perThousand: null });
  });

  it('refuses a case or a match that names an entry the list does not hold', () => {
    expect(() =>
      qualityPoint({
        identities: ['A'],
        cases: [{ id: 'c1', identity: 'Z', source: 'exact', matched: [] }],
        customers: [],
      }),
    ).toThrow(RangeError);
    expect(() =>
      qualityPoint({
        identities: ['A'],
        cases: [{ id: 'c1', identity: 'A', source: 'exact', matched: ['Z'] }],
        customers: [],
      }),
    ).toThrow(RangeError);
  });
});

describe('bootstrapQuality (over listed identities, not pairs)', () => {
  it('is reproducible from its seed, and another seed gives other draws', () => {
    const first = bootstrapQuality(SMALL, { replicates: 200, seed: 's1', keepSamples: true });
    const again = bootstrapQuality(SMALL, { replicates: 200, seed: 's1', keepSamples: true });
    const other = bootstrapQuality(SMALL, { replicates: 200, seed: 's2', keepSamples: true });

    expect(again).toEqual(first);
    expect(other.samples?.alertsPerThousand).not.toEqual(first.samples?.alertsPerThousand);
    expect(first.replicates).toBe(200);
  });

  it('counts every match a drawn case kept, once per draw, whatever else the replicate drew (owner decision 7 after 6C)', () => {
    // A's case matched A and B; B's case matched B. The list under test is fixed, so drawing
    // {A, A} still counts A's match to B, twice: precision 2 / 4. {B, B} gives 1 and {A, B} 2/3.
    const result = bootstrapQuality(
      {
        identities: ['A', 'B'],
        cases: [
          { id: 'a', identity: 'A', source: 'exact', matched: ['A', 'B'] },
          { id: 'b', identity: 'B', source: 'exact', matched: ['B'] },
        ],
        customers: [],
      },
      { replicates: 400, seed: 'pairs', keepSamples: true },
    );
    const values = new Set(result.samples?.precision.map((value) => value.toFixed(6)));

    expect(values).toEqual(new Set([(1 / 2).toFixed(6), (2 / 3).toFixed(6), (1).toFixed(6)]));
    expect(result.precision).toEqual([1 / 2, 1]);
  });

  it('alerts a drawn customer when it alerted against the whole list (owner decision 7 after 6C)', () => {
    // The customer matched B alone. Whether a replicate drew B does not matter: it alerts in each.
    const result = bootstrapQuality(
      { identities: ['A', 'B'], cases: [], customers: [{ id: 'k1', matched: ['B'] }] },
      { replicates: 400, seed: 'customers', keepSamples: true },
    );

    expect(new Set(result.samples?.alertsPerThousand)).toEqual(new Set([1000]));
    expect(result.alertsPerThousand).toEqual([1000, 1000]);
  });

  it('resamples the customers', () => {
    // One customer matched A, one matched nothing: a replicate gives 0, 500 or 1,000 per 1,000.
    const result = bootstrapQuality(
      {
        identities: ['A', 'B'],
        cases: [],
        customers: [
          { id: 'k1', matched: ['A'] },
          { id: 'k2', matched: [] },
        ],
      },
      { replicates: 400, seed: 'customers', keepSamples: true },
    );

    expect(new Set(result.samples?.alertsPerThousand)).toEqual(new Set([0, 500, 1000]));
    expect(result.alertsPerThousand).toEqual([0, 1000]);
    expect(result.precision).toBeNull();
  });

  it('gives degenerate intervals where nothing can vary, and an interval around each point', () => {
    const perfect = bootstrapQuality(
      {
        identities: ['A', 'B'],
        cases: [
          { id: 'a', identity: 'A', source: 'exact', matched: ['A'] },
          { id: 'b', identity: 'B', source: 'exact', matched: ['B'] },
        ],
        customers: [{ id: 'k1', matched: [] }],
      },
      { replicates: 100, seed: 'flat' },
    );

    expect(perfect.recall).toEqual({ exact: [1, 1] });
    expect(perfect.overall).toEqual([1, 1]);
    expect(perfect.precision).toEqual([1, 1]);
    expect(perfect.alertsPerThousand).toEqual([0, 0]);
    expect(perfect.samples).toBeUndefined();

    const intervals = bootstrapQuality(SMALL, { replicates: 1000, seed: 'small' });
    const point = qualityPoint(SMALL);
    const [low, high] = intervals.overall ?? [Number.NaN, Number.NaN];
    expect(low).toBeLessThanOrEqual(point.overall.value ?? Number.NaN);
    expect(high).toBeGreaterThanOrEqual(point.overall.value ?? Number.NaN);
  });

  it('leaves a source without a drawn case out of that replicate', () => {
    const result = bootstrapQuality(
      {
        identities: ['A', 'B'],
        cases: [
          { id: 'a', identity: 'A', source: 'exact', matched: ['A'] },
          { id: 'b', identity: 'B', source: 'typo', matched: [] },
        ],
        customers: [],
      },
      { replicates: 300, seed: 'gaps' },
    );

    expect(result.recall).toEqual({ exact: [1, 1], typo: [0, 0] });
  });

  it('refuses fewer than one replicate', () => {
    expect(() => bootstrapQuality(SMALL, { replicates: 0, seed: 'x' })).toThrow(RangeError);
  });
});

describe('performanceSummary (C78.7)', () => {
  /** @type {import('./benchmark-metrics.mjs').TimedScreening[]} */
  const screenings = [
    [10, 20, 30, 40],
    [11, 21, 31, 100],
    [12, 22, 32, 42],
  ].flatMap((times, round) =>
    times.map((ms, index) => ({
      round: round + 1,
      subject: /** @type {'listed' | 'unlisted'} */ (index % 2 === 0 ? 'listed' : 'unlisted'),
      ms,
      phases: { state: 1, retrieve: ms / 2, load: 2 },
      candidates: [100, 2000, 50, 2000][index] ?? 0,
      truncated: index % 2 === 1,
      kept: [1, 0, 0, 3][index] ?? 0,
      found: index % 2 === 0 ? index === 0 : null,
    })),
  );

  it('takes nearest-rank percentiles over every round, and each round p95', () => {
    const summary = performanceSummary(screenings);

    expect(summary.screenings).toBe(12);
    expect(summary.ms).toEqual({ p50: 22, p95: 100, p99: 100, max: 100 });
    expect(summary.roundP95).toEqual([40, 100, 42]);
    expect(summary.leastDisturbedRoundP95).toBe(40);
    expect(summary.phaseP95).toEqual({ state: 1, retrieve: 50, load: 2, rest: 47 });
  });

  it('counts, in the first round, the searches cut at the cap and those that would error', () => {
    const summary = performanceSummary(screenings);

    expect(summary.candidates).toEqual({ p50: 100, p95: 2000, max: 2000 });
    expect(summary.capBinds).toEqual({
      count: 2,
      of: 4,
      share: 0.5,
      interval: wilsonInterval(2, 4),
    });
    expect(summary.wouldError).toEqual({
      count: 1,
      of: 4,
      share: 0.25,
      interval: wilsonInterval(1, 4),
    });
    expect(summary.listedFound).toEqual({ found: 1, of: 2 });
  });

  it('counts, in the first round, the searches cut at the cap apart from those out of reach (calibration-6c follow-up)', () => {
    const recorded = screenings.map((item, index) => ({
      ...item,
      capReached: index % 4 === 1,
      unreachable: index % 4 === 3,
    }));

    const summary = performanceSummary(recorded);

    expect(summary.capBinds.count).toBe(2);
    expect(summary.capReached).toEqual({
      count: 1,
      of: 4,
      share: 0.25,
      interval: wilsonInterval(1, 4),
    });
    expect(summary.unreachable).toEqual({
      count: 1,
      of: 4,
      share: 0.25,
      interval: wilsonInterval(1, 4),
    });
    // Round files written before the members existed say nothing about either.
    expect(performanceSummary(screenings)).toMatchObject({ capReached: null, unreachable: null });
  });

  it('refuses an empty run', () => {
    expect(() => performanceSummary([])).toThrow(RangeError);
  });
});

/** A set built like Workflow 6C's company case: every match, kept or false, is to a resampled identity. */
function companyLike() {
  const random = seededRandom('decision-7/company-like');
  const identities = Array.from({ length: 50 }, (_, index) => `HZ-${String(index)}`);
  const sources = ['exact', 'typo', 'transposition', 'legal_form'];
  /** @type {QualityObservations} */
  const set = {
    identities,
    cases: identities.map((identity, index) => {
      const matched = new Set(random.chance(0.6) ? [identity] : []);
      for (let other = random.between(0, 3); other > 0; other -= 1) {
        matched.add(random.pick(identities));
      }
      return {
        id: `c${String(index)}`,
        identity,
        source: sources[index % sources.length] ?? 'exact',
        matched: [...matched],
      };
    }),
    customers: Array.from({ length: 80 }, (_, index) => ({
      id: `k${String(index)}`,
      matched: random.chance(0.35) ? [random.pick(identities)] : [],
    })),
  };
  return set;
}

/**
 * Workflow 6C's replicates (before owner decision 7), kept as the reference: a false match counts
 * only when the replicate drew its entry, and a customer alerts only when it drew one it matched.
 * @param {QualityObservations} set
 * @param {number} replicates
 * @param {string} seed
 */
function bootstrap6c(set, replicates, seed) {
  const position = new Map(set.identities.map((id, index) => [id, index]));
  const at = (/** @type {string} */ id) => position.get(id) ?? -1;
  const random = seededRandom(`evaluation-6/bootstrap/${seed}`);
  /** @type {{ precision: number[], alertsPerThousand: number[] }} */
  const out = { precision: [], alertsPerThousand: [] };
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const drawn = new Array(position.size).fill(0);
    for (let left = position.size; left > 0; left -= 1) {
      drawn[random.int(position.size)] += 1;
    }
    const customerDraws = new Array(set.customers.length).fill(0);
    for (let left = set.customers.length; left > 0; left -= 1) {
      customerDraws[random.int(set.customers.length)] += 1;
    }
    let expected = 0;
    let falseMatches = 0;
    for (const item of set.cases) {
      const times = drawn[at(item.identity)] ?? 0;
      const others = item.matched.filter((id) => id !== item.identity);
      expected += item.matched.includes(item.identity) ? times : 0;
      falseMatches += times * others.filter((id) => (drawn[at(id)] ?? 0) > 0).length;
    }
    out.precision.push(expected / (expected + falseMatches));
    let alerted = 0;
    for (const [index, customer] of set.customers.entries()) {
      const times = customerDraws[index] ?? 0;
      alerted += customer.matched.some((id) => (drawn[at(id)] ?? 0) > 0) ? times : 0;
    }
    out.alertsPerThousand.push((1000 * alerted) / set.customers.length);
  }
  return out;
}

describe('the list under test is fixed (owner decision 7 after Workflow 6C)', () => {
  it('a replicate that draws every identity and every customer once reproduces qualityPoint exactly', () => {
    const set = companyLike();
    const point = qualityPoint(set);
    const once = qualityReplicate(set, {
      identities: set.identities.map(() => 1),
      customers: set.customers.map(() => 1),
    });

    expect(point.precision.other).toBeGreaterThan(0);
    expect(point.alerts.alerted).toBeGreaterThan(0);
    expect(once).toEqual({
      recall: Object.fromEntries(
        Object.entries(point.recall).map(([source, value]) => [source, value.value]),
      ),
      overall: point.overall.value,
      precision: point.precision.value,
      alertsPerThousand: point.alerts.perThousand,
    });
  });

  it('counts a drawn case once per draw with every match it kept, and a drawn customer as it alerted', () => {
    const measures = qualityReplicate(
      {
        identities: ['A', 'B'],
        cases: [
          { id: 'a', identity: 'A', source: 'exact', matched: ['A', 'B'] },
          { id: 'b', identity: 'B', source: 'typo', matched: ['B'] },
        ],
        customers: [
          { id: 'k1', matched: ['B'] },
          { id: 'k2', matched: [] },
        ],
      },
      { identities: [2, 0], customers: [1, 1] },
    );

    expect(measures.recall.exact).toBe(1);
    expect(measures.recall.typo).toBeNaN();
    expect(measures.overall).toBe(1);
    expect(measures.precision).toBe(2 / 4);
    expect(measures.alertsPerThousand).toBe(500);
  });

  it('agrees with the 6C definition when no case or customer matches another resampled identity, and not otherwise', () => {
    const set = companyLike();
    /** @type {QualityObservations} */
    const own = {
      ...set,
      cases: set.cases.map((item) => ({
        ...item,
        matched: item.matched.filter((id) => id === item.identity),
      })),
      customers: set.customers.map((item) => ({ ...item, matched: [] })),
    };
    const samples = (/** @type {QualityObservations} */ observations) =>
      bootstrapQuality(observations, { replicates: 300, seed: 'agree', keepSamples: true }).samples;

    expect(samples(own)).toEqual(bootstrap6c(own, 300, 'agree'));
    expect(samples(set)?.precision).not.toEqual(bootstrap6c(set, 300, 'agree').precision);
    expect(samples(set)?.alertsPerThousand).not.toEqual(
      bootstrap6c(set, 300, 'agree').alertsPerThousand,
    );
  });

  it('keeps recall as it was: the identities are drawn as before', () => {
    const set = companyLike();
    const intervals = bootstrapQuality(set, { replicates: 300, seed: 'recall' });
    const reference = bootstrapQuality(
      { ...set, customers: set.customers.map((item) => ({ ...item, matched: [] })) },
      { replicates: 300, seed: 'recall' },
    );

    expect(intervals.recall).toEqual(reference.recall);
    expect(intervals.overall).toEqual(reference.overall);
  });
});
