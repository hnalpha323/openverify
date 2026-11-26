/**
 * C164.7, C164.8 (review P21): the time lattice of a window, its days, weeks from Monday (ISO 8601)
 * and months, each cut to the window, and its total.
 */
import { describe, expect, it } from 'vitest';
import { ANALYTICS_MAX_RANGE_DAYS } from './definitions.js';
import { analyticsBucketNodes, analyticsTimeLattice } from './lattice.js';

describe('analyticsTimeLattice (C164.8)', () => {
  it('lists each local day of the window, both ends included', () => {
    const lattice = analyticsTimeLattice('2026-02-26', '2026-03-03');
    expect(lattice.days.map((node) => node.id)).toEqual([
      'day:2026-02-26',
      'day:2026-02-27',
      'day:2026-02-28',
      'day:2026-03-01',
      'day:2026-03-02',
      'day:2026-03-03',
    ]);
    expect(lattice.days[0]).toEqual({
      id: 'day:2026-02-26',
      kind: 'day',
      start: '2026-02-26',
      end: '2026-02-26',
      days: ['2026-02-26'],
    });
  });

  it('starts each week on a Monday and cuts the first and last week to the window', () => {
    // 2026-02-26 is a Thursday; 2026-03-02 a Monday.
    const lattice = analyticsTimeLattice('2026-02-26', '2026-03-10');
    expect(lattice.weeks.map((node) => [node.id, node.start, node.end, node.days.length])).toEqual([
      ['week:2026-02-26', '2026-02-26', '2026-03-01', 4],
      ['week:2026-03-02', '2026-03-02', '2026-03-08', 7],
      ['week:2026-03-09', '2026-03-09', '2026-03-10', 2],
    ]);
  });

  it('cuts each month to the window, a week across two months belonging to both', () => {
    const lattice = analyticsTimeLattice('2026-02-26', '2026-03-10');
    expect(lattice.months.map((node) => [node.id, node.start, node.end, node.days.length])).toEqual(
      [
        ['month:2026-02', '2026-02-26', '2026-02-28', 3],
        ['month:2026-03', '2026-03-01', '2026-03-10', 10],
      ],
    );
    expect(lattice.total).toMatchObject({
      id: 'total',
      kind: 'total',
      start: '2026-02-26',
      end: '2026-03-10',
    });
    expect(lattice.total.days).toHaveLength(13);
  });

  it('counts a leap day and the year end like any other day', () => {
    const lattice = analyticsTimeLattice('2028-02-28', '2029-01-02');
    expect(lattice.days.map((node) => node.start)).toContain('2028-02-29');
    expect(lattice.months.map((node) => node.id).slice(-2)).toEqual([
      'month:2028-12',
      'month:2029-01',
    ]);
    expect(lattice.total.days).toHaveLength(310);
  });

  it('answers the nodes of each bucket in order', () => {
    const lattice = analyticsTimeLattice('2026-02-26', '2026-03-10');
    expect(analyticsBucketNodes(lattice, 'day')).toBe(lattice.days);
    expect(analyticsBucketNodes(lattice, 'week')).toBe(lattice.weeks);
    expect(analyticsBucketNodes(lattice, 'month')).toBe(lattice.months);
  });

  it('accepts a window of one day and of the longest length, and refuses a longer one', () => {
    expect(analyticsTimeLattice('2026-05-05', '2026-05-05').total.days).toEqual(['2026-05-05']);
    const longest = analyticsTimeLattice('2025-01-01', '2026-02-04');
    expect(longest.total.days).toHaveLength(ANALYTICS_MAX_RANGE_DAYS);
    expect(() => analyticsTimeLattice('2025-01-01', '2026-02-05')).toThrow(RangeError);
  });

  it.each([
    ['2026-03-02', '2026-03-01'],
    ['2026-02-30', '2026-03-01'],
    ['2026-3-1', '2026-03-02'],
    ['2026-03-01T00:00:00Z', '2026-03-02'],
  ])('refuses the window %s to %s', (from, to) => {
    expect(() => analyticsTimeLattice(from, to)).toThrow(RangeError);
  });
});
