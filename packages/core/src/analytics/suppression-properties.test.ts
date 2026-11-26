/**
 * C164.7 (reviews P21, H18; `analytics-logic`): property tests over seeded synthetic tables.
 * - P21: no hidden cell can be derived from the visible others, within an answer and across its
 *   day, week and month answers (the lattice's every node, checked together, by an independent
 *   dense elimination);
 * - H18: the true rate lies inside every bound shown, and no exact rate reveals a hidden cell;
 * - a shown count is 0 or at least the threshold, wherever it sits.
 */
import { describe, expect, it } from 'vitest';
import { ANALYTICS_RELATIONS } from './metrics.js';
import {
  analyticsSeriesCellId as cellId,
  analyticsTimeLattice,
  suppressAnalyticsTable,
  type AnalyticsAdditiveGroup,
  type AnalyticsTable,
  type AnalyticsTimeLattice,
} from './suppression.js';
import { derivableCells } from './testing/derivation-check.js';
import { cpuMilliseconds, seededRandom, type SeededRandom } from './testing/random.js';

const ATOMS = ['a', 'b', 'c', 'd', 'e'] as const;
/** t1 = a + b, t2 = t1 + c, and c + e = d + f through the virtual v. */
const RELATIONS: readonly AnalyticsAdditiveGroup[] = [
  { total: 't1', parts: ['a', 'b'] },
  { total: 't2', parts: ['t1', 'c'] },
  { total: 'v', parts: ['c', 'e'] },
  { total: 'v', parts: ['d', 'f'] },
];
const SERIES = ['a', 'b', 'c', 'd', 'e', 'f', 't1', 't2'] as const;
const RATES = [
  ['a', 't1'],
  ['t1', 't2'],
  ['c', 't2'],
] as const;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A count drawn to provoke suppression: zeros, small counts and shown ones. */
const draw = (random: SeededRandom, threshold: number) =>
  random.chance(0.3)
    ? 0
    : random.chance(0.5)
      ? random.int(1, threshold - 1)
      : random.int(threshold, threshold * 4);

interface Case {
  readonly threshold: number;
  readonly lattice: AnalyticsTimeLattice;
  readonly series: Map<string, Map<string, number>>;
  readonly cells: Map<string, number>;
  readonly groups: AnalyticsAdditiveGroup[];
}

function seededCase(seed: number, maxDays: number): Case {
  const random = seededRandom(seed);
  const threshold = random.int(11, 20);
  const from = addDays('2026-01-01', random.int(0, 300));
  const lattice = analyticsTimeLattice(from, addDays(from, random.int(0, maxDays - 1)));
  const series = new Map<string, Map<string, number>>(SERIES.map((key) => [key, new Map()]));
  for (const day of lattice.total.days) {
    const atom = Object.fromEntries(ATOMS.map((key) => [key, draw(random, threshold)]));
    const a = atom.a ?? 0;
    const b = atom.b ?? 0;
    const c = atom.c ?? 0;
    const e = atom.e ?? 0;
    const d = Math.min(atom.d ?? 0, c + e);
    const values = { a, b, c, d, e, f: c + e - d, t1: a + b, t2: a + b + c };
    for (const [key, value] of Object.entries(values)) {
      series.get(key)?.set(day, value);
    }
  }
  // Off the time axis: a's window total split into three groups.
  const total = [...(series.get('a')?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  const first = random.int(0, total);
  const second = random.int(0, total - first);
  const cells = new Map([
    ['group-1', first],
    ['group-2', second],
    ['group-3', total - first - second],
  ]);
  const groups = [{ total: cellId('a', 'total'), parts: ['group-1', 'group-2', 'group-3'] }];
  return { threshold, lattice, series, cells, groups };
}

const nodesOf = (lattice: AnalyticsTimeLattice) => [
  ...lattice.days,
  ...lattice.weeks,
  ...lattice.months,
  lattice.total,
];

/** Every relation the cells obey, rebuilt here from the lattice (not taken from the table). */
function everyRelation(test: Case): AnalyticsAdditiveGroup[] {
  const groups: AnalyticsAdditiveGroup[] = [...test.groups];
  for (const key of [...SERIES, 'v']) {
    for (const node of [...test.lattice.weeks, ...test.lattice.months, test.lattice.total]) {
      groups.push({
        total: cellId(key, node),
        parts: node.days.map((day) => cellId(key, `day:${day}`)),
      });
    }
  }
  for (const relation of RELATIONS) {
    for (const node of nodesOf(test.lattice)) {
      groups.push({
        total: cellId(relation.total, node),
        parts: relation.parts.map((part) => cellId(part, node)),
      });
    }
  }
  return groups;
}

function shownCells(test: Case): Map<string, number> {
  const shown = new Map(test.cells);
  for (const [key, days] of test.series) {
    for (const node of nodesOf(test.lattice)) {
      shown.set(
        cellId(key, node),
        node.days.reduce((sum, day) => sum + (days.get(day) ?? 0), 0),
      );
    }
  }
  return shown;
}

const tableOf = (test: Case): AnalyticsTable =>
  suppressAnalyticsTable({
    threshold: test.threshold,
    lattice: test.lattice,
    series: test.series,
    relations: RELATIONS,
    cells: test.cells,
    groups: test.groups,
  });

const SEEDS = Array.from({ length: 24 }, (_, index) => 9000 + index);

describe('complementary suppression on seeded tables (review P21)', () => {
  it.each(SEEDS)('seed %i: no hidden cell follows from the shown ones, on any bucket', (seed) => {
    const test = seededCase(seed, 24);
    const table = tableOf(test);
    const shown = shownCells(test);
    const unknown = new Set<string>();
    for (const node of nodesOf(test.lattice)) {
      unknown.add(cellId('v', node));
    }
    for (const [id, value] of shown) {
      const cell = table.count(id);
      if (typeof cell === 'number') {
        expect(cell, id).toBe(value);
        expect(cell === 0 || cell >= test.threshold, id).toBe(true);
      } else {
        unknown.add(id);
        expect(value, id).toBeGreaterThan(0);
        expect(cell.suppressed, id).toBe(value < test.threshold ? 'small-count' : 'complementary');
      }
    }
    const derivable = [...derivableCells(unknown, everyRelation(test))].filter((id) =>
      shown.has(id),
    );
    expect(derivable).toEqual([]);
  });

  it('hides the same cells whatever bucket an answer lists: one table serves them all', () => {
    const test = seededCase(4242, 40);
    const first = tableOf(test);
    const again = tableOf({
      ...test,
      series: new Map([...test.series].reverse()),
      cells: new Map([...test.cells].reverse()),
    });
    for (const id of shownCells(test).keys()) {
      expect(again.count(id), id).toEqual(first.count(id));
    }
  });

  it('protects a 60-day window across its weeks and months as well', () => {
    const test = seededCase(77, 60);
    const table = tableOf(test);
    const shown = shownCells(test);
    const unknown = new Set(nodesOf(test.lattice).map((node) => cellId('v', node)));
    for (const id of shown.keys()) {
      if (typeof table.count(id) !== 'number') {
        unknown.add(id);
      }
    }
    expect([...derivableCells(unknown, everyRelation(test))].filter((id) => shown.has(id))).toEqual(
      [],
    );
  });
});

describe('rate bounds on seeded tables (review H18)', () => {
  it.each(SEEDS)('seed %i: every rate shown holds the true rate', (seed) => {
    const test = seededCase(seed, 24);
    const table = tableOf(test);
    const shown = shownCells(test);
    for (const node of nodesOf(test.lattice)) {
      for (const [numerator, denominator] of RATES) {
        const n = cellId(numerator, node);
        const d = cellId(denominator, node);
        const rate = table.rate([n], [d]);
        const truth = (shown.get(n) ?? Number.NaN) / (shown.get(d) ?? Number.NaN);
        if ('value' in rate) {
          expect(rate.value).toBe(truth);
          expect(typeof table.count(n)).toBe('number');
          expect(typeof table.count(d)).toBe('number');
        } else if ('below' in rate) {
          expect(truth * 100).toBeLessThan(rate.below);
          expect(typeof table.count(d)).toBe('number');
        } else if ('above' in rate) {
          expect(truth * 100).toBeGreaterThan(rate.above);
          expect(typeof table.count(d)).toBe('number');
          expect(typeof table.count(n)).toBe('number');
        }
      }
    }
  });
});

describe('the cost of the largest answer (C164.8: 400 days)', () => {
  /** A 400-day inquiries table, its counts per day obeying `ANALYTICS_RELATIONS.inquiries`. */
  function inquiryTable(seed: number, scale: number) {
    const random = seededRandom(seed);
    const lattice = analyticsTimeLattice('2025-01-01', '2026-02-04');
    const series = new Map<string, Map<string, number>>();
    const set = (key: string, day: string, value: number) => {
      const days = series.get(key) ?? new Map<string, number>();
      days.set(day, value);
      series.set(key, days);
    };
    const count = () => (random.chance(0.4) ? 0 : random.int(0, scale));
    for (const day of lattice.total.days) {
      const atoms = {
        'completed-verified': count(),
        'completed-with-fallback': count(),
        'completed-unverified': count(),
        failed: count(),
        approved: count(),
        declined: count(),
        'needs-review': count(),
        'expired-after-start': count(),
        'expired-before-start': count(),
      };
      const completed =
        atoms['completed-verified'] +
        atoms['completed-with-fallback'] +
        atoms['completed-unverified'];
      const finished =
        completed + atoms.failed + atoms.approved + atoms.declined + atoms['needs-review'];
      const started = finished + atoms['expired-after-start'];
      const values: Record<string, number> = {
        ...atoms,
        completed,
        finished,
        started,
        created: started + atoms['expired-before-start'],
        interacted: random.int(0, started),
        'marked-for-review': random.int(0, finished),
        'decided-automatic': count(),
        'decided-manual': count(),
        'decided-not-declared': count(),
      };
      for (const [key, value] of Object.entries(values)) {
        set(key, day, value);
      }
    }
    return () =>
      suppressAnalyticsTable({
        threshold: 11,
        lattice,
        series,
        relations: ANALYTICS_RELATIONS.inquiries,
      });
  }

  /**
   * Provisional, with its basis: the worst answer of C164.8 (400 days of day buckets, 22 series under
   * the inquiry relations) took 0.3 s (small) and 1.5 s (busy) of CPU alone at a load of 10, and
   * 5.0 s for the busy one under v8 coverage in the package's parallel run. 15 s leaves room for
   * coverage and load, and still fails a return to the first draft's whole-system re-elimination
   * (11 s and 26 s without coverage). Tuned on nothing but these runs of the same seeded tables.
   */
  const BUDGET_MS = 15_000;

  it.each([
    ['a small environment, most days below the threshold', 4],
    ['a busy environment, a few days below it', 60],
  ])('suppresses %s within the CPU budget', (_label, scale) => {
    const build = inquiryTable(31, scale);
    let table: AnalyticsTable | undefined;
    const used = cpuMilliseconds(() => {
      table = build();
    });
    expect(table?.count('created@total')).toBeTypeOf('number');
    expect(used).toBeLessThan(BUDGET_MS);
  });
});
