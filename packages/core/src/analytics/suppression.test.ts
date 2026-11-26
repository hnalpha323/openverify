/**
 * C164.7 (Phase 9, Workflow 9B; decision 37; reviews H18, P21; `analytics-logic`): small-count
 * suppression, rate bounds that hold the true value and complementary suppression, each checked
 * against its definition. The property tests over seeded tables are in `suppression-properties`.
 */
import { describe, expect, it } from 'vitest';
import { durationBuckets } from './durations.js';
import {
  analyticsRelationGroups,
  analyticsSeriesCellId,
  analyticsTimeLattice,
  complementarySuppression,
  suppressAnalyticsTable,
  suppressCount,
  suppressDuration,
  suppressRate,
  type AnalyticsRateCell,
} from './suppression.js';
import { derivableCells } from './testing/derivation-check.js';

const histogramWith = (entries: Readonly<Record<number, number>>): number[] =>
  Array.from({ length: 40 }, (_, index) => entries[index] ?? 0);

describe('suppressCount (C164.7)', () => {
  it('shows zero, hides 1 to threshold minus one as a small count, and shows the rest', () => {
    expect(suppressCount(0, 11)).toBe(0);
    for (let count = 1; count <= 10; count += 1) {
      expect(suppressCount(count, 11)).toEqual({ suppressed: 'small-count' });
    }
    expect(suppressCount(11, 11)).toBe(11);
    expect(suppressCount(19, 20)).toEqual({ suppressed: 'small-count' });
    expect(suppressCount(20, 20)).toBe(20);
    expect(suppressCount(99, 100)).toEqual({ suppressed: 'small-count' });
    expect(suppressCount(1_000_000, 100)).toBe(1_000_000);
  });

  it.each([10, 101, 11.5, Number.NaN])('refuses the threshold %s (floor 11, at most 100)', (t) => {
    expect(() => suppressCount(5, t)).toThrow(RangeError);
  });

  it.each([-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses the count %s', (count) => {
    expect(() => suppressCount(count, 11)).toThrow(RangeError);
  });
});

/**
 * The bounds by their definition, searched rather than computed: the strictest whole percent that
 * every rate the shown counts allow lies strictly inside.
 */
function expectedRate(numerator: number, denominator: number, t: number): AnalyticsRateCell {
  const complement = denominator - numerator;
  if (denominator < t || (numerator < t && complement < t)) {
    return { suppressed: true };
  }
  if (numerator >= t && complement >= t) {
    return { value: numerator / denominator };
  }
  // Every numerator the cell allows: 0 to t - 1 (numerator small), or D - t + 1 to D.
  const allowed =
    numerator < t
      ? Array.from({ length: t }, (_, n) => n)
      : Array.from({ length: t }, (_, c) => denominator - c);
  if (numerator < t) {
    for (let below = 1; below <= 100; below += 1) {
      if (allowed.every((n) => n * 100 < below * denominator)) {
        return { below };
      }
    }
  }
  for (let above = 99; above >= 0; above -= 1) {
    if (allowed.every((n) => n * 100 > above * denominator)) {
      return { above };
    }
  }
  throw new Error('no bound');
}

describe('suppressRate (C164.7, review H18)', () => {
  it('matches the searched definition for every numerator and denominator up to 80', () => {
    for (const t of [11, 15, 20]) {
      for (let denominator = 0; denominator <= 80; denominator += 1) {
        for (let numerator = 0; numerator <= denominator; numerator += 1) {
          expect(
            suppressRate({ numerator, denominator }, t),
            `${String(numerator)}/${String(denominator)}`,
          ).toEqual(expectedRate(numerator, denominator, t));
        }
      }
    }
  });

  it('shows the plan examples: under and over bounds rounded outward, strict', () => {
    // A 98% rate on 50 reveals one failure: shown as a bound only (engineering note 6.4).
    expect(suppressRate({ numerator: 49, denominator: 50 }, 11)).toEqual({ above: 79 });
    expect(suppressRate({ numerator: 3, denominator: 400 }, 11)).toEqual({ below: 3 });
    // 10 of 20: the numerator and its complement are both small, so no one-sided bound holds.
    expect(suppressRate({ numerator: 10, denominator: 20 }, 11)).toEqual({ suppressed: true });
    // 100 * 10 / 40 is a whole 25: "under 25%" would not hold for 10 of 40, so the bound is 26;
    // likewise "over 75%" for 30 of 40, so it is 74 (strict bounds, ours).
    expect(suppressRate({ numerator: 10, denominator: 40 }, 11)).toEqual({ below: 26 });
    expect(suppressRate({ numerator: 30, denominator: 40 }, 11)).toEqual({ above: 74 });
    expect(suppressRate({ numerator: 20, denominator: 40 }, 11)).toEqual({ value: 0.5 });
  });

  it('never shows a rate whose denominator is small, zero included', () => {
    expect(suppressRate({ numerator: 0, denominator: 0 }, 11)).toEqual({ suppressed: true });
    expect(suppressRate({ numerator: 5, denominator: 10 }, 11)).toEqual({ suppressed: true });
  });

  it('refuses a numerator above its denominator, a negative or a fractional count', () => {
    expect(() => suppressRate({ numerator: 12, denominator: 11 }, 11)).toThrow(RangeError);
    expect(() => suppressRate({ numerator: -1, denominator: 11 }, 11)).toThrow(RangeError);
    expect(() => suppressRate({ numerator: 1.5, denominator: 11 }, 11)).toThrow(RangeError);
    expect(() => suppressRate({ numerator: 1, denominator: 11 }, 8)).toThrow(RangeError);
  });
});

describe('complementarySuppression (C164.7, review P21)', () => {
  const hide = (values: Record<string, number>, groups: { total: string; parts: string[] }[]) =>
    Object.fromEntries(complementarySuppression(new Map(Object.entries(values)), groups, 11));

  it('hides only the small counts when no group would reveal one', () => {
    expect(hide({ a: 5, b: 0, c: 30 }, [])).toEqual({ a: 'small-count' });
    expect(hide({ a: 11, b: 0 }, [{ total: 'total', parts: ['a', 'b'] }])).toEqual({});
  });

  it('hides the next smallest part when a total and all but one part are shown', () => {
    expect(
      hide({ total: 100, a: 5, b: 20, c: 30, d: 45 }, [
        { total: 'total', parts: ['a', 'b', 'c', 'd'] },
      ]),
    ).toEqual({ a: 'small-count', b: 'complementary' });
  });

  it('never hides a zero, skipping it for the next smallest part', () => {
    expect(
      hide({ total: 100, a: 5, b: 0, c: 95 }, [{ total: 'total', parts: ['a', 'b', 'c'] }]),
    ).toEqual({ a: 'small-count', c: 'complementary' });
  });

  it('hides the total when the small part has no other part to hide', () => {
    expect(hide({ total: 7, a: 7, b: 0 }, [{ total: 'total', parts: ['a', 'b'] }])).toEqual({
      total: 'small-count',
      a: 'small-count',
    });
    expect(hide({ total: 25, a: 5, b: 0 }, [{ total: 'total', parts: ['a', 'b'] }])).toEqual({
      total: 'complementary',
      a: 'small-count',
    });
  });

  it('needs nothing more when the total is no shown cell', () => {
    expect(hide({ a: 5, b: 20 }, [{ total: 'virtual', parts: ['a', 'b'] }])).toEqual({
      a: 'small-count',
    });
  });

  it('follows a chain: a cell hidden for one group is protected in the group above it', () => {
    const groups = [
      { total: 'all', parts: ['left', 'right'] },
      { total: 'left', parts: ['a', 'b'] },
    ];
    const hidden = hide({ all: 200, left: 8, right: 192, a: 3, b: 5 }, groups);
    expect(hidden).toEqual({
      left: 'small-count',
      a: 'small-count',
      b: 'small-count',
      right: 'complementary',
    });
    expect(derivableCells(new Set(Object.keys(hidden)), groups).size).toBe(0);
  });

  it('protects a cell that no single group reveals, but three together do', () => {
    // T1 = a + b, T2 = b + c, T3 = a + c: each group hides two cells, yet a = (T1 - T2 + T3) / 2.
    const groups = [
      { total: 't1', parts: ['a', 'b'] },
      { total: 't2', parts: ['b', 'c'] },
      { total: 't3', parts: ['a', 'c'] },
    ];
    const hidden = hide({ t1: 8, t2: 9, t3: 7, a: 3, b: 5, c: 4 }, groups);
    // Every small cell is hidden; the totals are small too, so all six are.
    expect(Object.keys(hidden).sort()).toEqual(['a', 'b', 'c', 't1', 't2', 't3']);
    const wide = hide({ t1: 13, t2: 14, t3: 12, a: 3, b: 10, c: 4 }, groups);
    expect(wide.a).toBe('small-count');
    expect(derivableCells(new Set(Object.keys(wide)), groups).size).toBe(0);
  });

  it('protects every cell of a two-way table whose margins are all shown', () => {
    const values: Record<string, number> = {
      r1: 40,
      r2: 60,
      k1: 30,
      k2: 30,
      k3: 40,
      'r1/k1': 3,
      'r1/k2': 25,
      'r1/k3': 12,
      'r2/k1': 27,
      'r2/k2': 5,
      'r2/k3': 28,
    };
    const groups = [
      { total: 'r1', parts: ['r1/k1', 'r1/k2', 'r1/k3'] },
      { total: 'r2', parts: ['r2/k1', 'r2/k2', 'r2/k3'] },
      { total: 'k1', parts: ['r1/k1', 'r2/k1'] },
      { total: 'k2', parts: ['r1/k2', 'r2/k2'] },
      { total: 'k3', parts: ['r1/k3', 'r2/k3'] },
    ];
    const hidden = hide(values, groups);
    expect(hidden['r1/k1']).toBe('small-count');
    expect(hidden['r2/k2']).toBe('small-count');
    expect(derivableCells(new Set(Object.keys(hidden)), groups).size).toBe(0);
  });

  it('protects a bridge between two blocks, which every row and column alone would let pass', () => {
    // Two 2 x 2 blocks of small cells joined by one small cell (r2/k3): every row and column holds
    // two hidden cells or more, yet the margins of rows r1, r2 less those of columns k1, k2 give it.
    const small = new Map([
      ['r1/k1', 2],
      ['r1/k2', 3],
      ['r2/k1', 4],
      ['r2/k2', 5],
      ['r2/k3', 6],
      ['r3/k3', 7],
      ['r3/k4', 8],
      ['r4/k3', 9],
      ['r4/k4', 1],
    ]);
    const values: Record<string, number> = {};
    const groups: { total: string; parts: string[] }[] = [];
    const indices = [1, 2, 3, 4];
    for (const row of indices) {
      for (const column of indices) {
        values[`r${String(row)}/k${String(column)}`] =
          small.get(`r${String(row)}/k${String(column)}`) ?? 20;
      }
    }
    for (const index of indices) {
      const row = indices.map((column) => `r${String(index)}/k${String(column)}`);
      const column = indices.map((other) => `r${String(other)}/k${String(index)}`);
      values[`r${String(index)}`] = row.reduce((sum, id) => sum + (values[id] ?? 0), 0);
      values[`k${String(index)}`] = column.reduce((sum, id) => sum + (values[id] ?? 0), 0);
      groups.push({ total: `r${String(index)}`, parts: row });
      groups.push({ total: `k${String(index)}`, parts: column });
    }
    // The small cells alone leave the bridge derivable, which the check below must catch.
    expect(derivableCells(new Set(small.keys()), groups)).toContain('r2/k3');
    const hidden = hide(values, groups);
    for (const id of small.keys()) {
      expect(hidden[id], id).toBe('small-count');
    }
    expect(Object.values(hidden)).toContain('complementary');
    expect(derivableCells(new Set(Object.keys(hidden)), groups).size).toBe(0);
  });

  it('answers the same cells whatever order the cells and groups come in', () => {
    const values = { total: 100, a: 5, b: 20, c: 20, d: 55 };
    const groups = [
      { total: 'total', parts: ['a', 'b', 'c', 'd'] },
      { total: 'pair', parts: ['b', 'c'] },
    ];
    const forward = hide(values, groups);
    const backward = Object.fromEntries(
      complementarySuppression(
        new Map(Object.entries(values).reverse()),
        [...groups].reverse().map((group) => ({ ...group, parts: [...group.parts].reverse() })),
        11,
      ),
    );
    expect(backward).toEqual(forward);
  });

  it('refuses a group naming a cell twice, an empty group and a bad threshold', () => {
    expect(() => hide({ a: 1 }, [{ total: 'a', parts: ['a'] }])).toThrow(RangeError);
    expect(() => hide({ a: 1 }, [{ total: 'x', parts: [] }])).toThrow(RangeError);
    expect(() => complementarySuppression(new Map([['a', 1]]), [], 5)).toThrow(RangeError);
    expect(() => complementarySuppression(new Map([['a', -1]]), [], 11)).toThrow(RangeError);
  });
});

describe('suppressDuration (C163.5, C164.7)', () => {
  it('shows the bucket of the percentile, hidden below the threshold and null when empty', () => {
    expect(suppressDuration(histogramWith({}), 50, 11)).toBeNull();
    expect(suppressDuration(histogramWith({ 12: 10 }), 50, 11)).toEqual({ suppressed: true });
    expect(suppressDuration(histogramWith({ 12: 6, 20: 5 }), 50, 11)).toEqual(
      durationBuckets()[12],
    );
    expect(suppressDuration(histogramWith({ 12: 6, 20: 5 }), 90, 11)).toEqual(
      durationBuckets()[20],
    );
  });
});

describe('the cell ids and relation groups (C164.7)', () => {
  it('names a series cell by its key and node', () => {
    const lattice = analyticsTimeLattice('2026-03-02', '2026-03-03');
    expect(analyticsSeriesCellId('created', lattice.total)).toBe('created@total');
    expect(analyticsSeriesCellId('created', 'day:2026-03-02')).toBe('created@day:2026-03-02');
    expect(() => analyticsSeriesCellId('a@b', 'total')).toThrow(RangeError);
    expect(() => analyticsSeriesCellId('', 'total')).toThrow(RangeError);
  });

  it('maps relations between keys to groups between cells', () => {
    expect(
      analyticsRelationGroups(
        [{ total: 'runs', parts: ['passed', 'failed'] }],
        (key) => `check-1/${key}`,
      ),
    ).toEqual([{ total: 'check-1/runs', parts: ['check-1/passed', 'check-1/failed'] }]);
  });
});

describe('suppressAnalyticsTable (C164.7, review P21)', () => {
  const week = () => analyticsTimeLattice('2026-03-02', '2026-03-08');
  const series = (counts: readonly number[]) =>
    new Map(counts.map((count, index) => [week().total.days[index] ?? '', count]));

  it('hides a small day, and a second day of its week so the week cannot reveal it', () => {
    const lattice = week();
    const table = suppressAnalyticsTable({
      threshold: 11,
      lattice,
      series: new Map([['created', series([40, 3, 50, 60, 70, 80, 90])]]),
    });
    expect(table.count('created@day:2026-03-03')).toEqual({ suppressed: 'small-count' });
    expect(table.count('created@day:2026-03-02')).toEqual({ suppressed: 'complementary' });
    expect(table.count('created@day:2026-03-04')).toBe(50);
    expect(table.count('created@total')).toBe(393);
    expect(table.count(`created@${lattice.weeks[0]?.id ?? ''}`)).toBe(393);
    expect(table.suppressedAmong(lattice.days.map((node) => `created@${node.id}`))).toBe(2);
  });

  it('applies a relation at every node, a key with no series being a virtual cell', () => {
    const lattice = week();
    const table = suppressAnalyticsTable({
      threshold: 11,
      lattice,
      series: new Map([
        ['finished', series([30, 30, 30, 30, 30, 30, 30])],
        ['passed', series([25, 25, 25, 25, 25, 25, 25])],
        ['failed', series([5, 5, 5, 5, 5, 5, 5])],
      ]),
      relations: [{ total: 'finished', parts: ['passed', 'failed'] }],
    });
    // Each day's failed (5) is small, so each day's passed is hidden; the week's 35 is shown.
    expect(table.count('failed@day:2026-03-02')).toEqual({ suppressed: 'small-count' });
    expect(table.count('passed@day:2026-03-02')).toEqual({ suppressed: 'complementary' });
    expect(table.count('failed@total')).toBe(35);
    expect(table.count('passed@total')).toBe(175);
    expect(() => table.count('missing@total')).toThrow(RangeError);
  });

  it('computes a rate from shown cells only, never one that would reveal a hidden cell', () => {
    const lattice = week();
    const table = suppressAnalyticsTable({
      threshold: 11,
      lattice,
      series: new Map([
        ['finished', series([30, 30, 30, 30, 30, 30, 30])],
        ['passed', series([25, 25, 25, 25, 25, 25, 25])],
        ['failed', series([5, 5, 5, 5, 5, 5, 5])],
      ]),
      relations: [{ total: 'finished', parts: ['passed', 'failed'] }],
    });
    // A day: failed is small, finished shown: "under 34%" from the threshold and 30 alone.
    expect(table.rate(['failed@day:2026-03-02'], ['finished@day:2026-03-02'])).toEqual({
      below: 34,
    });
    // passed is hidden (complementary): its exact rate would reveal it, and so would its bound.
    expect(table.rate(['passed@day:2026-03-02'], ['finished@day:2026-03-02'])).toEqual({
      suppressed: true,
    });
    expect(table.rate(['passed@total'], ['finished@total'])).toEqual({ value: 175 / 210 });
  });

  it('takes cells off the time axis with their own relations and declared virtual ids', () => {
    const lattice = week();
    const table = suppressAnalyticsTable({
      threshold: 11,
      lattice,
      series: new Map([['started', series([10, 10, 10, 10, 10, 10, 10])]]),
      cells: new Map([
        ['version-1', 50],
        ['version-2', 15],
        ['version-3', 5],
      ]),
      groups: [{ total: 'started@total', parts: ['version-1', 'version-2', 'version-3'] }],
    });
    expect(table.count('started@total')).toBe(70);
    expect(table.count('version-3')).toEqual({ suppressed: 'small-count' });
    expect(table.count('version-2')).toEqual({ suppressed: 'complementary' });
    expect(() =>
      suppressAnalyticsTable({
        threshold: 11,
        lattice,
        cells: new Map([['a', 5]]),
        groups: [{ total: 'undeclared', parts: ['a'] }],
      }),
    ).toThrow(RangeError);
    expect(
      suppressAnalyticsTable({
        threshold: 11,
        lattice,
        cells: new Map([['a', 5]]),
        groups: [{ total: 'population', parts: ['a'] }],
        virtual: ['population'],
      }).count('a'),
    ).toEqual({ suppressed: 'small-count' });
  });

  it('refuses a day outside the window and a cell id holding @', () => {
    const lattice = week();
    expect(() =>
      suppressAnalyticsTable({
        threshold: 11,
        lattice,
        series: new Map([['created', new Map([['2026-03-09', 3]])]]),
      }),
    ).toThrow(RangeError);
    expect(() =>
      suppressAnalyticsTable({ threshold: 11, lattice, cells: new Map([['a@b', 3]]) }),
    ).toThrow(RangeError);
  });
});
