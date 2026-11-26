import { describe, expect, it } from 'vitest';
import { seededRandom } from './random.js';

describe('seededRandom (C111.1: every fixture reproducible from its seed)', () => {
  it('gives the same sequence for the same seed, and another for another seed', () => {
    const a = seededRandom('seed-a');
    const b = seededRandom('seed-a');
    const c = seededRandom('seed-c');
    const first = Array.from({ length: 16 }, () => a.next());
    expect(Array.from({ length: 16 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 16 }, () => c.next())).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('draws integers and 128-bit integers inside inclusive bounds, reaching both ends', () => {
    const random = seededRandom('bounds');
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i += 1) {
      const value = random.int(-2, 3);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2, 3]);
    const max = (1n << 128n) - 1n;
    const big = new Set<bigint>();
    for (let i = 0; i < 2_000; i += 1) {
      const value = random.bigint(max - 3n, max);
      expect(value >= max - 3n && value <= max).toBe(true);
      big.add(value);
    }
    expect(big.size).toBe(4);
    const wide = random.bigint(0n, max);
    expect(wide >= 0n && wide <= max).toBe(true);
    expect(random.bigint(7n, 7n)).toBe(7n);
  });

  it('picks, shuffles into a permutation and writes hex', () => {
    const random = seededRandom('lists');
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(items).toContain(random.pick(items));
    const shuffled = random.shuffle(items);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(random.hex(40)).toMatch(/^[0-9a-f]{40}$/);
    expect(() => random.pick([])).toThrow(RangeError);
    expect(() => random.int(3, 2)).toThrow(RangeError);
  });
});
