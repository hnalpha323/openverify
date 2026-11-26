// @ts-check
import { describe, expect, it } from 'vitest';
import { bootstrapQuality, qualityPoint, wilsonInterval } from './benchmark-metrics.mjs';
import { seededRandom } from '../src/testing/random.js';
import {
  differenceOf,
  intervalsOf,
  pairedPoint,
  pairedReplicate,
  pairedSamples,
} from './benchmark-paired.mjs';

/** @typedef {import('./benchmark-paired.mjs').PairedObservations} PairedObservations */

/** Three listed identities; A's case also matched B; customers matched A, nothing, or A and C. */
const SMALL = /** @type {PairedObservations} */ ({
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

/**
 * @param {PairedObservations} run
 * @param {(item: PairedObservations['cases'][number]) => readonly string[]} matched
 * @returns {PairedObservations}
 */
const withCases = (run, matched) => ({
  ...run,
  cases: run.cases.map((item) => ({ ...item, matched: matched(item) })),
});

describe('pairedPoint', () => {
  it('counts what qualityPoint counts, with a Wilson interval beside each share', () => {
    const point = pairedPoint(SMALL);
    const quality = qualityPoint(SMALL);

    expect(point.recall.typo).toMatchObject(quality.recall.typo ?? {});
    expect(point.recall.typo?.wilson).toEqual(wilsonInterval(1, 2));
    expect(point.overall).toEqual({ ...quality.overall, wilson: wilsonInterval(2, 3) });
    expect(point.precision).toEqual({ ...quality.precision, wilson: wilsonInterval(2, 3) });
    const per1000 = (wilsonInterval(2, 4) ?? [0, 0]).map((value) => value * 1000);
    expect(point.alerts).toEqual({ ...quality.alerts, wilson: per1000 });
  });

  it('counts the matches to the fixed table, the customer alerting on them alone included', () => {
    const point = pairedPoint({
      identities: ['A'],
      cases: [{ id: 'c1', identity: 'A', source: 'exact', matched: ['A'], fixed: 3 }],
      customers: [
        { id: 'k1', matched: [], fixed: 2 },
        { id: 'k2', matched: [] },
      ],
    });

    expect(point.precision).toMatchObject({ expected: 1, other: 3, value: 0.25 });
    expect(point.alerts).toMatchObject({ customers: 2, alerted: 1, matches: 2, perThousand: 500 });
  });

  it('gives a zero count its Wilson interval and no rate without trials', () => {
    const point = pairedPoint({
      identities: ['A'],
      cases: [{ id: 'c1', identity: 'A', source: 'exact', matched: [] }],
      customers: [],
    });

    expect(point.overall).toEqual({ hits: 0, cases: 1, value: 0, wilson: wilsonInterval(0, 1) });
    expect(point.precision).toEqual({ expected: 0, other: 0, value: null, wilson: null });
    expect(point.alerts).toEqual({
      customers: 0,
      alerted: 0,
      matches: 0,
      perThousand: null,
      wilson: null,
    });
  });
});

describe('pairedSamples (one stream, every run on the same draws)', () => {
  it('reproduces bootstrapQuality for a run without fixed matches, under its label', () => {
    const [samples] = pairedSamples([SMALL], { replicates: 500, seed: 's1' });
    if (samples === undefined) {
      throw new Error('one run, one sample');
    }
    const intervals = intervalsOf(samples);
    const reference = bootstrapQuality(SMALL, { replicates: 500, seed: 's1' });

    expect(intervals).toEqual({
      recall: reference.recall,
      overall: reference.overall,
      precision: reference.precision,
      alertsPerThousand: reference.alertsPerThousand,
    });
  });

  it('counts a fixed match in every replicate', () => {
    const [samples] = pairedSamples(
      [
        {
          identities: ['A', 'B'],
          cases: [{ id: 'c1', identity: 'A', source: 'exact', matched: [], fixed: 1 }],
          customers: [{ id: 'k1', matched: [], fixed: 1 }],
        },
      ],
      { replicates: 200, seed: 'fixed' },
    );

    expect(new Set(samples?.alertsPerThousand)).toEqual(new Set([1000]));
    expect(new Set(samples?.precision.filter(Number.isFinite))).toEqual(new Set([0]));
  });

  it('pairs runs replicate by replicate, so equal runs differ by nothing and a gain stays a gain', () => {
    const head = withCases(SMALL, (item) => (item.id === 'c2' ? ['B'] : item.matched));
    const [base, same, better] = pairedSamples([SMALL, SMALL, head], {
      replicates: 400,
      seed: 'pairs',
    });
    if (base === undefined || same === undefined || better === undefined) {
      throw new Error('three runs, three samples');
    }
    const none = intervalsOf(differenceOf(base, same));
    const gain = differenceOf(base, better);

    expect(none.overall).toEqual([0, 0]);
    expect(none.alertsPerThousand).toEqual([0, 0]);
    expect(gain.overall.filter(Number.isFinite).every((value) => value >= 0)).toBe(true);
    expect(gain.overall.some((value) => value > 0)).toBe(true);
    expect(intervalsOf(gain).recall.exact).toEqual([0, 0]);
  });

  it('draws another stream under another label, and the same under the same', () => {
    const first = pairedSamples([SMALL], { replicates: 200, seed: 's', label: 'one' });
    const again = pairedSamples([SMALL], { replicates: 200, seed: 's', label: 'one' });
    const other = pairedSamples([SMALL], { replicates: 200, seed: 's', label: 'two' });

    expect(again).toEqual(first);
    expect(other[0]?.alertsPerThousand).not.toEqual(first[0]?.alertsPerThousand);
  });

  it('refuses runs that are not paired, unknown identities and fewer than one replicate', () => {
    const options = { replicates: 10, seed: 'x' };
    expect(() =>
      pairedSamples([SMALL, { ...SMALL, identities: ['A', 'C', 'B'] }], options),
    ).toThrow(RangeError);
    expect(() =>
      pairedSamples([SMALL, { ...SMALL, customers: SMALL.customers.slice(1) }], options),
    ).toThrow(RangeError);
    expect(() => pairedSamples([SMALL, withCases(SMALL, () => [])], options)).not.toThrow();
    expect(() =>
      pairedSamples([SMALL, { ...SMALL, cases: SMALL.cases.slice(1) }], options),
    ).toThrow(RangeError);
    expect(() => pairedSamples([withCases(SMALL, () => ['Z'])], options)).toThrow(RangeError);
    expect(() => pairedSamples([SMALL], { replicates: 0, seed: 'x' })).toThrow(RangeError);
    expect(() => pairedSamples([], options)).toThrow(RangeError);
  });
});

describe('differenceOf and intervalsOf', () => {
  it('subtracts replicate by replicate, a missing value staying missing, and takes nearest-rank intervals', () => {
    const base = {
      recall: { typo: [0.5, Number.NaN, 1] },
      overall: [0.5, 0.6, 0.7],
      precision: [1, 1, Number.NaN],
      alertsPerThousand: [100, 200, 300],
    };
    const head = {
      recall: { typo: [1, 1, 1] },
      overall: [0.6, 0.6, 0.6],
      precision: [0.5, 1, 1],
      alertsPerThousand: [150, 200, 250],
    };
    const difference = differenceOf(base, head);

    expect(difference.recall.typo?.[1]).toBeNaN();
    expect(difference.recall.typo?.[0]).toBeCloseTo(0.5);
    expect(difference.alertsPerThousand).toEqual([50, 0, -50]);
    expect(intervalsOf(difference)).toMatchObject({
      alertsPerThousand: [-50, 50],
      precision: [-0.5, 0],
    });
    expect(intervalsOf({ ...difference, overall: [Number.NaN] }).overall).toBeNull();
  });
});

/**
 * A run built like Workflow 6C's company case at scale: the population's cases and customers match
 * resampled identities, and some match the table's own entries (`fixed`).
 * @returns {PairedObservations}
 */
function companyLike() {
  const random = seededRandom('decision-7/paired-company-like');
  const identities = Array.from({ length: 50 }, (_, index) => `HZ-${String(index)}`);
  const sources = ['exact', 'typo', 'transposition', 'legal_form'];
  return {
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
        fixed: random.chance(0.3) ? random.between(1, 4) : 0,
      };
    }),
    customers: Array.from({ length: 80 }, (_, index) => ({
      id: `k${String(index)}`,
      matched: random.chance(0.35) ? [random.pick(identities)] : [],
      fixed: random.chance(0.1) ? 1 : 0,
    })),
  };
}

/**
 * Workflow 6C's replicates (before owner decision 7), kept as the reference: a match to a resampled
 * identity counts only when the replicate drew it; a fixed match always counts.
 * @param {PairedObservations} run
 * @param {number} replicates
 * @param {string} label
 */
function samples6c(run, replicates, label) {
  const position = new Map(run.identities.map((id, index) => [id, index]));
  const at = (/** @type {string} */ id) => position.get(id) ?? -1;
  const random = seededRandom(label);
  /** @type {{ precision: number[], alertsPerThousand: number[] }} */
  const out = { precision: [], alertsPerThousand: [] };
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const drawn = new Array(position.size).fill(0);
    for (let left = position.size; left > 0; left -= 1) {
      drawn[random.int(position.size)] += 1;
    }
    const customerDraws = new Array(run.customers.length).fill(0);
    for (let left = run.customers.length; left > 0; left -= 1) {
      customerDraws[random.int(run.customers.length)] += 1;
    }
    let expected = 0;
    let falseMatches = 0;
    for (const item of run.cases) {
      const times = drawn[at(item.identity)] ?? 0;
      const others = item.matched.filter((id) => id !== item.identity);
      expected += item.matched.includes(item.identity) ? times : 0;
      falseMatches +=
        times * ((item.fixed ?? 0) + others.filter((id) => (drawn[at(id)] ?? 0) > 0).length);
    }
    out.precision.push(expected / (expected + falseMatches));
    let alerted = 0;
    for (const [index, customer] of run.customers.entries()) {
      const alerts =
        (customer.fixed ?? 0) > 0 || customer.matched.some((id) => (drawn[at(id)] ?? 0) > 0);
      alerted += alerts ? (customerDraws[index] ?? 0) : 0;
    }
    out.alertsPerThousand.push((1000 * alerted) / run.customers.length);
  }
  return out;
}

describe('the list under test is fixed (owner decision 7 after Workflow 6C)', () => {
  it('a replicate that draws every identity and every customer once reproduces pairedPoint exactly', () => {
    const run = companyLike();
    const point = pairedPoint(run);
    const once = pairedReplicate(run, {
      identities: run.identities.map(() => 1),
      customers: run.customers.map(() => 1),
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

  it('counts a drawn case with every match it kept and its fixed ones, and a drawn customer as it alerted', () => {
    const measures = pairedReplicate(
      {
        identities: ['A', 'B'],
        cases: [{ id: 'a', identity: 'A', source: 'exact', matched: ['A', 'B'], fixed: 2 }],
        customers: [
          { id: 'k1', matched: ['B'] },
          { id: 'k2', matched: [], fixed: 1 },
          { id: 'k3', matched: [] },
        ],
      },
      { identities: [3, 0], customers: [1, 1, 1] },
    );

    expect(measures).toEqual({
      recall: { exact: 1 },
      overall: 1,
      precision: 3 / (3 + 3 * 3),
      alertsPerThousand: 2000 / 3,
    });
  });

  it('agrees with the 6C definition when no case or customer matches another resampled identity, and not otherwise', () => {
    const run = companyLike();
    /** @type {PairedObservations} */
    const own = {
      ...run,
      cases: run.cases.map((item) => ({
        ...item,
        matched: item.matched.filter((id) => id === item.identity),
      })),
      customers: run.customers.map((item) => ({ ...item, matched: [] })),
    };
    const label = 'decision-7/agree';
    const [ownSamples, runSamples] = pairedSamples([own, run], {
      replicates: 300,
      seed: 'x',
      label,
    });

    expect({
      precision: ownSamples?.precision,
      alertsPerThousand: ownSamples?.alertsPerThousand,
    }).toEqual(samples6c(own, 300, label));
    expect(runSamples?.precision).not.toEqual(samples6c(run, 300, label).precision);
    expect(runSamples?.alertsPerThousand).not.toEqual(samples6c(run, 300, label).alertsPerThousand);
    expect(runSamples?.overall).toEqual(ownSamples?.overall);
  });
});
