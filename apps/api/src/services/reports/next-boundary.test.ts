/**
 * C74.3 (b), C74.5 (R005): `nextBoundary`, the schedule's next run. Boundaries are `from + k`
 * intervals; the first one after now is taken, and a `from` still ahead is that boundary itself.
 */
import { describe, expect, it } from 'vitest';
import { nextBoundary } from './reports.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('nextBoundary', () => {
  it('keeps a boundary still ahead (a resume before the next run is due)', () => {
    expect(nextBoundary(days(10), 30, NOW)).toEqual(days(10));
    expect(nextBoundary(new Date(NOW.getTime() + 1), 1, NOW)).toEqual(new Date(NOW.getTime() + 1));
  });

  it('moves a due boundary to the first one after now, without drift', () => {
    expect(nextBoundary(NOW, 7, NOW)).toEqual(days(7));
    expect(nextBoundary(days(-1), 7, NOW)).toEqual(days(6));
    expect(nextBoundary(days(-7), 7, NOW)).toEqual(days(7));
    expect(nextBoundary(days(-15), 7, NOW)).toEqual(days(6));
  });
});
