/**
 * C164.7 (review P21; `analytics-logic`): the exact check of `derivation.ts` against the independent
 * dense elimination of the tests, on seeded random systems of groups, in both of its arithmetics,
 * whole and component by component; and the known cells each derivation reads.
 */
import { describe, expect, it } from 'vitest';
import {
  determinedByComponent,
  determinedUnknowns,
  determinedUnknownsExact,
  type DerivationGroup,
} from './derivation.js';
import { derivableCells } from './testing/derivation-check.js';
import { seededRandom } from './testing/random.js';

function seededSystem(seed: number) {
  const random = seededRandom(seed);
  const cells = Array.from({ length: random.int(4, 18) }, (_, index) => `c${String(index)}`);
  const groups: DerivationGroup[] = Array.from({ length: random.int(1, 14) }, () => {
    const members = [...cells].sort(() => random.next() - 0.5).slice(0, random.int(2, 6));
    return { total: members[0] ?? 'c0', parts: members.slice(1) };
  });
  const unknown = new Set(cells.filter(() => random.chance(0.5)));
  return { cells, groups, unknown };
}

const SEEDS = Array.from({ length: 200 }, (_, index) => 100 + index);

describe('determinedUnknowns (C164.7)', () => {
  it('agrees with the independent check on 200 seeded systems, in both arithmetics', () => {
    for (const seed of SEEDS) {
      const { groups, unknown } = seededSystem(seed);
      const expected = [...derivableCells(unknown, groups)].sort();
      expect([...determinedUnknowns(unknown, groups).keys()].sort(), String(seed)).toEqual(
        expected,
      );
      expect([...determinedUnknownsExact(unknown, groups).keys()].sort(), String(seed)).toEqual(
        expected,
      );
      expect(
        [...determinedByComponent(unknown, groups, new Map()).keys()].sort(),
        String(seed),
      ).toEqual(expected);
    }
  });

  it('names the known cells a derivation reads, each with a non-zero net coefficient', () => {
    // a = t - b - c with c = u: c cancels between the first two groups (a also follows from v - w,
    // a dependency the reduction meets after it has a's row, so the first derivation is kept).
    const groups = [
      { total: 't', parts: ['a', 'b', 'c'] },
      { total: 'u', parts: ['c'] },
      { total: 'v', parts: ['a', 'w'] },
    ];
    const determined = determinedUnknowns(new Set(['a', 'c']), groups);
    expect(determined.get('a')).toEqual(['b', 't', 'u']);
    expect(determined.get('c')).toEqual(['u']);
  });

  it('reuses a component it has answered, and forgets the ones no longer asked', () => {
    const groups = [
      { total: 't', parts: ['a', 'b'] },
      { total: 'u', parts: ['x', 'y'] },
    ];
    const cache = new Map<string, ReadonlyMap<string, readonly string[]>>();
    determinedByComponent(new Set(['a', 'x']), groups, cache);
    expect([...cache.keys()].sort()).toEqual(['a', 'x']);
    const before = cache.get('a');
    determinedByComponent(new Set(['a', 'x', 'y']), groups, cache);
    expect(cache.get('a')).toBe(before);
    expect([...cache.keys()].sort()).toEqual(['a', 'x\ny']);
  });
});
